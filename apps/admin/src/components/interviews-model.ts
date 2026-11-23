import type { Application, Attendance, InterviewSlot, SlotMode } from "@website/domain/recruitment";

export interface SlotApplicant {
  applicationId: string;
  version: number;
  choiceId: string;
  name: string;
  attendance: Attendance | null;
}

export interface SlotItem {
  id: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  booked: number;
  mode: SlotMode;
  location: string;
  note: string;
  unitName: string | null;
  interviewerName: string | null;
  /** The interviewer opened it (or the viewer is the committee): they may change and cancel it. */
  own: boolean;
  applicants: SlotApplicant[];
}

/** Slots with the applicants booked on them (one booking per chosen unit). */
export function toSlotItems(
  slots: readonly InterviewSlot[],
  applications: readonly Application[],
  names: ReadonlyMap<string, string>,
  own: (slot: InterviewSlot) => boolean,
): SlotItem[] {
  return slots.map((s) => ({
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    durationMinutes: s.durationMinutes,
    capacity: s.capacity,
    booked: s.booked,
    mode: s.mode,
    location: s.location,
    note: s.note,
    unitName: s.orgUnitId ? (names.get(s.orgUnitId) ?? s.orgUnitId) : null,
    interviewerName: s.interviewerUid ? (names.get(s.interviewerUid) ?? s.interviewerUid) : null,
    own: own(s),
    applicants: applications.flatMap((a) =>
      Object.entries(a.interviews)
        .filter(([, b]) => b.slotId === s.id)
        .map(([choiceId, b]) => ({
          applicationId: a.id,
          version: a.version,
          choiceId,
          name: names.get(a.userId) ?? a.userId,
          attendance: b.attendance,
        })),
    ),
  }));
}
