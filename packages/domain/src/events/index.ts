import { z } from "zod";
import { safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { TimezoneSchema } from "../members/profile";
import { isValidSlug, type EntityMeta } from "../shared";
import { isLive } from "./lifecycle";
import type { EventFee, PublicFee } from "./payment";
import { toPublicFee } from "./payment";
import type { AttendanceMode, EventRegistrationSetup } from "./registration";

export const EVENT_TYPES = [
  "general",
  "seminar",
  "webinar",
  "discussion",
  "workshop",
  "launch",
  "event",
  "festival",
  "conference",
  "exhibition",
  "meeting",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventImage = FeaturedImage;

export interface ScheduleRow {
  readonly time: string;
  readonly title: string;
  readonly description: string;
}
export interface Speaker {
  readonly name: string;
  readonly description: string;
  readonly photo: EventImage | null;
}
export interface Sponsor {
  readonly order: number;
  readonly logo: EventImage | null;
  readonly caption: string;
}

export interface EventEntity extends EntityMeta {
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly timezone: string;
  readonly location: string | null;
  readonly chapterId: string | null;
  readonly published: boolean;
  readonly capacity: number | null;
  readonly registrationClosesAt: Date | null;
  readonly type: EventType;
  readonly description: string;
  readonly bannerImage: EventImage | null;
  readonly registrationUrl: string | null;
  readonly schedule: readonly ScheduleRow[];
  readonly speakers: readonly Speaker[];
  readonly sponsors: readonly Sponsor[];
  /** A published event stays hidden until this time (a read-time rule, no job). */
  readonly publishAt: Date | null;
  readonly approvalRequestedAt: Date | null;
  readonly approvalRequestedBy: string | null;
  readonly approvedAt: Date | null;
  readonly approvedBy: string | null;
  readonly rejectionNote: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly finalAttendance: number | null;
  readonly attendanceNote: string | null;
  readonly recapUrl: string | null;
  /** The form asked at registration; null = one-click registration. */
  readonly registration: EventRegistrationSetup | null;
  /** Fee categories and payment instructions (N1.3); null = a free event. */
  readonly fee: EventFee | null;
}

export function sortedSponsors(sponsors: readonly Sponsor[]): Sponsor[] {
  return [...sponsors].sort((a, b) => a.order - b.order);
}

export interface PublicEvent {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly type: EventType;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly timezone: string;
  readonly registrationClosesAt: Date | null;
  readonly location: string | null;
  readonly chapterId: string | null;
  readonly description: string;
  readonly bannerImage: EventImage | null;
  readonly registrationUrl: string | null;
  readonly schedule: readonly ScheduleRow[];
  readonly speakers: readonly Speaker[];
  readonly sponsors: readonly Sponsor[];
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly finalAttendance: number | null;
  readonly attendanceNote: string | null;
  readonly recapUrl: string | null;
  /** Set when the event asks questions: the register button leads to the wizard page. */
  readonly registration: { readonly attendanceModes: readonly AttendanceMode[] } | null;
  readonly fee: PublicFee | null;
}

export function toPublicEvent(e: EventEntity): PublicEvent {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    type: e.type,
    startsAt: e.startsAt,
    endsAt: e.endsAt ?? null,
    timezone: e.timezone,
    registrationClosesAt: e.registrationClosesAt,
    location: e.location,
    chapterId: e.chapterId,
    description: e.description,
    bannerImage: e.bannerImage,
    registrationUrl: e.registrationUrl,
    schedule: e.schedule,
    speakers: e.speakers,
    sponsors: sortedSponsors(e.sponsors),
    cancelledAt: e.cancelledAt,
    cancelReason: e.cancelReason,
    finalAttendance: e.finalAttendance,
    attendanceNote: e.attendanceNote,
    recapUrl: e.recapUrl,
    registration: e.registration && { attendanceModes: e.registration.attendanceModes },
    fee: toPublicFee(e.fee),
  };
}

export function randomEventSlug(uuid: string): string {
  return `event-${uuid.replace(/-/g, "").slice(0, 8)}`;
}

const optionalText = (max: number) => safeText(max, { multiline: true, allowEmpty: true });
const linkSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || /^https?:\/\/[^\s]+$/i.test(value), "Use an http(s):// link.")
  .transform((value) => value || null);

export const EventInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(3, "Enter a title (at least 3 characters).")),
    type: z.enum(EVENT_TYPES, { error: "Choose an event type." }),
    startsAt: z.coerce.date({ error: "Enter the event date and time." }),
    timezone: TimezoneSchema,
    registrationClosesAt: z.coerce.date().nullable(),
    location: safeText(300).pipe(z.string().min(2, "Enter the location.")),
    description: safeText(5000, { multiline: true }),
    bannerImage: FeaturedImageSchema.nullable().refine((v) => v !== null, "Upload a banner."),
    registrationUrl: linkSchema,
    slug: z
      .string()
      .trim()
      .max(120)
      .refine((s) => s === "" || isValidSlug(s), "Use lower-case letters, numbers and dashes."),
    schedule: z
      .array(
        z
          .object({
            time: z.string().regex(/^(|([01]\d|2[0-3]):[0-5]\d)$/, "Use HH:MM."),
            title: safeText(200),
            description: optionalText(500),
          })
          .strict(),
      )
      .max(50),
    speakers: z
      .array(
        z
          .object({
            name: safeText(120),
            description: optionalText(500),
            photo: FeaturedImageSchema.nullable(),
          })
          .strict(),
      )
      .max(30),
    sponsors: z
      .array(z.object({ logo: FeaturedImageSchema.nullable(), caption: safeText(200) }).strict())
      .max(50),
  })
  .strict()
  .refine((e) => e.registrationClosesAt === null || e.registrationClosesAt <= e.startsAt, {
    path: ["registrationClosesAt"],
    message: "The deadline must be on or before the event date.",
  });
export type EventInput = z.infer<typeof EventInputSchema>;

/** What the organiser types after the event; shown on the public page. */
export const EventAfterSchema = z
  .object({
    finalAttendance: z.number().int().min(0).max(1_000_000).nullable(),
    attendanceNote: safeText(200, { allowEmpty: true }).transform((value) => value || null),
    recapUrl: linkSchema,
  })
  .strict();
export type EventAfterInput = z.infer<typeof EventAfterSchema>;

export function isRegistrationOpen(
  event: Pick<
    EventEntity,
    "published" | "deletedAt" | "publishAt" | "cancelledAt" | "startsAt" | "registrationClosesAt"
  >,
  now: Date,
): boolean {
  if (!isLive(event, now) || event.cancelledAt !== null) return false;
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  return now < closesAt;
}

/** `pending` = a seat held for a paid event until the payment is verified (N1.3). */
export type RegistrationStatus = "pending" | "confirmed" | "waitlisted" | "cancelled";

export interface EventRegistration {
  readonly id: string;
  readonly eventId: string;
  readonly userId: string;
  readonly status: RegistrationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function registrationId(eventId: string, userId: string): string {
  return `${eventId}_${userId}`;
}

export function nextRegistrationStatus(
  event: Pick<EventEntity, "capacity">,
  confirmedCount: number,
): RegistrationStatus {
  return event.capacity === null || confirmedCount < event.capacity ? "confirmed" : "waitlisted";
}

export interface EventReader {
  listPublished(input: {
    chapterId?: string;
    updatedSince?: Date;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: EventEntity[];
    nextCursor: string | null;
  }>;
  findById(id: string): Promise<EventEntity | null>;
}

export interface MeetingProvider {
  createMeeting(input: {
    topic: string;
    startsAt: Date;
    durationMinutes: number;
    timezone: string;
  }): Promise<{
    meetingId: string;
    joinUrl: string;
  }>;
}

export interface CalendarFeed {
  render(events: readonly EventEntity[]): string;
}

export * from "./checkin";
export * from "./committee";
export * from "./evaluation";
export * from "./committee-title";
export * from "./lifecycle";
export * from "./payment";
export * from "./registration";
