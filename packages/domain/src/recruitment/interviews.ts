import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import type { ActiveSeat, AppointmentSeat, OrgUnitType } from "../organizations";
import { RuleViolationError } from "../shared";
import type { ApplicationStatus, Booking, InterviewSlot } from "./index";

export const ATTENDANCE_STATES = ["attended", "absent"] as const;
export type Attendance = (typeof ATTENDANCE_STATES)[number];
export const SLOT_MODES = ["online", "onsite"] as const;
export type SlotMode = (typeof SLOT_MODES)[number];
export const DEFAULT_CUTOFF_HOURS = 12;

/** Booking (and changing a booking) closes `bookingCutoffHours` before the start. */
export const bookingOpen = (
  slot: Pick<InterviewSlot, "startsAt" | "bookingCutoffHours">,
  now: Date,
): boolean => slot.startsAt.getTime() - slot.bookingCutoffHours * 3_600_000 > now.getTime();

/** Seats whose holders interview (step 11.5). */
const INTERVIEWER_SEATS: readonly AppointmentSeat[] = ["head", "deputy_head", "secretary"];
/** Their scope reaches every unit below. */
const SUBTREE_UNIT_TYPES: readonly OrgUnitType[] = ["direktorat", "biro"];

export interface InterviewScope {
  /** Every applicant. */
  readonly all: boolean;
  /** Units whose applicants the person may see (with the units below them). */
  readonly orgUnitIds: ReadonlySet<string>;
  /** Units the person may open interview times for (the seat's own unit). */
  readonly slotUnitIds: ReadonlySet<string>;
}

export const hasInterviewScope = (s: InterviewScope) => s.all || s.orgUnitIds.size > 0;

/**
 * Block N: who interviews. Seat head / deputy head / secretary (a directorate or bureau reaches the
 * units below it), the `recruitment.interview` extra (`granted`: "all" or the units of its
 * assignments) and `recruitment.review` (everyone).
 */
export function interviewScope(input: {
  seats: readonly ActiveSeat[];
  units: ReadonlyArray<{ id: string; path: readonly string[] }>;
  review: boolean;
  granted: "all" | readonly string[];
}): InterviewScope {
  const below = (id: string) => input.units.filter((u) => u.path.includes(id)).map((u) => u.id);
  const seats = input.seats.filter((s) => INTERVIEWER_SEATS.includes(s.seat));
  const granted = input.granted === "all" ? [] : input.granted;
  const own = [...seats.map((s) => s.orgUnitId), ...granted];
  const subtree = [
    ...seats.filter((s) => SUBTREE_UNIT_TYPES.includes(s.unitType)).map((s) => s.orgUnitId),
    ...granted,
  ];
  return {
    all: input.review || input.granted === "all",
    orgUnitIds: new Set([...own, ...subtree.flatMap(below)]),
    slotUnitIds: new Set(own),
  };
}

/** An applicant is in scope when a chosen unit is, or when they booked one of my slots. */
export function applicantInScope(
  scope: InterviewScope,
  uid: string,
  application: {
    readonly choices: readonly string[];
    readonly interviews: Readonly<Record<string, Pick<Booking, "slotId">>>;
  },
  slots: ReadonlyMap<string, Pick<InterviewSlot, "interviewerUid">>,
): boolean {
  return (
    scope.all ||
    application.choices.some((c) => scope.orgUnitIds.has(c)) ||
    Object.values(application.interviews).some((b) => slots.get(b.slotId)?.interviewerUid === uid)
  );
}

const REVIEWED: readonly ApplicationStatus[] = [
  "interview",
  "offered",
  "accepted",
  "declined",
  "approved",
  "pakta_review",
  "confirmed",
  "rejected",
];
/** Interviewers open applications only after the administrative review passed. */
export const passedReview = (status: ApplicationStatus) => REVIEWED.includes(status);

/** A slot is offered to applicants of its unit and of every unit below it. */
export const slotOffered = (
  slot: Pick<InterviewSlot, "orgUnitId">,
  choice: string,
  choicePath: readonly string[],
): boolean =>
  slot.orgUnitId === null || slot.orgUnitId === choice || choicePath.includes(slot.orgUnitId);

export const SlotChangeSchema = z
  .object({
    id: safeId,
    startsAt: z.coerce.date().optional(),
    durationMinutes: z.number().int().min(5).max(240).optional(),
    capacity: z.number().int().min(1).max(50).optional(),
    mode: z.enum(SLOT_MODES).optional(),
    location: safeText(500, { allowEmpty: true }).optional(),
    note: safeText(500, { allowEmpty: true }).optional(),
    bookingCutoffHours: z.number().int().min(0).max(168).optional(),
  })
  .strict();
export type SlotChange = z.output<typeof SlotChangeSchema>;

/** A booked slot keeps its time and length and its bookings; link, address and note can change. */
export function assertSlotEdit(
  slot: Pick<InterviewSlot, "startsAt" | "capacity" | "booked" | "durationMinutes">,
  change: Omit<SlotChange, "id">,
): void {
  if (slot.booked === 0) return;
  const moved =
    (change.startsAt !== undefined && change.startsAt.getTime() !== slot.startsAt.getTime()) ||
    (change.durationMinutes !== undefined && change.durationMinutes !== slot.durationMinutes);
  if (moved) throw new RuleViolationError("Someone booked this time; it cannot be moved.");
  if (change.capacity !== undefined && change.capacity < slot.booked) {
    throw new RuleViolationError("The capacity cannot go below the bookings.");
  }
}

type NoticeFields = Pick<InterviewSlot, "startsAt" | "mode" | "location" | "note">;
/** What an applicant is told about: time, mode, link or address, note. */
export const slotNoticeChanged = (a: NoticeFields, b: NoticeFields): boolean =>
  a.startsAt.getTime() !== b.startsAt.getTime() ||
  a.mode !== b.mode ||
  a.location !== b.location ||
  a.note !== b.note;

/** An applicant changes or cancels a booking once, before the cut-off, before it is recorded. */
export function assertBookingChangeable(
  booking: Booking,
  cutoffHours: number,
  alreadyChanged: boolean,
  now: Date,
): void {
  if (booking.attendance !== null) {
    throw new RuleViolationError("This interview was recorded; it cannot be changed.");
  }
  if (alreadyChanged) throw new RuleViolationError("You can change or cancel an interview once.");
  if (!bookingOpen({ startsAt: booking.startsAt, bookingCutoffHours: cutoffHours }, now)) {
    throw new RuleViolationError("The time to change this interview has closed.");
  }
}

export const AttendanceSchema = z
  .object({
    id: safeId,
    choiceId: safeId,
    attendance: z.enum(ATTENDANCE_STATES),
    note: safeText(500, { allowEmpty: true }),
    version: z.number().int().min(1),
  })
  .strict();
