import "server-only";
import type { SqlMeetingStore } from "@website/db/sql";
import { markAttendance, normalizeCode } from "@website/domain/meetings";
import { RuleViolationError } from "@website/domain/shared";

export type AttendResult =
  | { ok: true; title: string; at: string; zone: string }
  | { ok: false; error: "signin" | "invalid" | "not_participant" | "closed" };

export interface AttendCard {
  readonly title: string;
  readonly startsAt: string;
  readonly zone: string;
  readonly unit: string | null;
  readonly place: string | null;
  /** ISO time of the person's own record, when they already signed. */
  readonly recordedAt: string | null;
}

/** The person's own time zone (profile), else null: callers fall back to the meeting's. */
type ZoneOf = (uid: string) => Promise<string | null>;

export function createAttend(deps: {
  meetings: Pick<SqlMeetingStore, "findCode" | "attend">;
  zoneOf: ZoneOf;
  now: () => Date;
}) {
  return async (uid: string | null, typed: string): Promise<AttendResult> => {
    if (!uid) return { ok: false, error: "signin" };
    const code = normalizeCode(typed);
    if (!code) return { ok: false, error: "invalid" };
    const now = deps.now();
    const meetingId = await deps.meetings.findCode(code, now);
    if (!meetingId) return { ok: false, error: "invalid" };
    try {
      const saved = await deps.meetings.attend(
        meetingId,
        (m) => markAttendance(m, uid, "code", now),
        now,
      );
      return {
        ok: true,
        title: saved.title,
        at: (saved.attendance[uid]?.at ?? now).toISOString(),
        zone: (await deps.zoneOf(uid)) ?? saved.timeZone,
      };
    } catch (error) {
      if (!(error instanceof RuleViolationError)) throw error;
      return {
        ok: false,
        error: error.message.startsWith("You are not") ? "not_participant" : "closed",
      };
    }
  };
}

/** What the attendance page shows before the button. Looking a code up never records anything. */
export function createAttendCard(deps: {
  meetings: Pick<SqlMeetingStore, "findCode" | "get">;
  unitName: (orgUnitId: string) => Promise<string | null>;
  zoneOf: ZoneOf;
  now: () => Date;
}) {
  return async (uid: string, typed: string): Promise<AttendCard | null> => {
    const code = normalizeCode(typed);
    const meetingId = code ? await deps.meetings.findCode(code, deps.now()) : null;
    const meeting = meetingId ? await deps.meetings.get(meetingId) : null;
    if (!meeting || meeting.deletedAt || !meeting.participantIds.includes(uid)) return null;
    const own = meeting.attendance[uid];
    return {
      title: meeting.title,
      startsAt: meeting.startsAt.toISOString(),
      zone: (await deps.zoneOf(uid)) ?? meeting.timeZone,
      unit: meeting.orgUnitId ? await deps.unitName(meeting.orgUnitId) : null,
      // shortcut: a Zoom booking shows as "Zoom" (its link is on the admin page); upgrade if web needs the join link
      place: meeting.room.externalUrl ?? (meeting.room.zoomRequestId ? "Zoom" : null),
      recordedAt: own?.status === "present" ? own.at.toISOString() : null,
    };
  };
}
