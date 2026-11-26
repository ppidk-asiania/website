import { utcToWallTime } from "../shared";
import type { PaymentState } from "./payment";
import type { RegistrationStatus } from "./index";

/** How a person was marked present: the same field for every way of checking in (N1.4). */
export const CHECKIN_METHODS = ["self", "scan", "manual"] as const;
export type CheckInMethod = (typeof CHECKIN_METHODS)[number];

/** The person who checked someone in may undo it for this long; a holder of `registrants.edit` at any time. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** What a scan or a manual check-in answers (the door staff reads one card). */
export type CheckInOutcome =
  "checked_in" | "already" | "not_paid" | "waitlisted" | "cancelled" | "unknown";

/** Only a confirmed registration (and, on a paid event, a verified payment) can enter. */
export function checkInOutcome(registration: {
  readonly status: RegistrationStatus;
  readonly payment: PaymentState;
  readonly checkedInAt: Date | null;
}): CheckInOutcome {
  if (registration.status === "cancelled") return "cancelled";
  if (registration.status === "waitlisted") return "waitlisted";
  if (
    registration.status === "pending" ||
    registration.payment === "unpaid" ||
    registration.payment === "submitted" ||
    registration.payment === "rejected"
  ) {
    return "not_paid";
  }
  return registration.checkedInAt ? "already" : "checked_in";
}

export function canUndoCheckIn(
  checkedIn: { readonly by: string | null; readonly at: Date },
  actor: { readonly userId: string; readonly canEditRegistrants: boolean },
  now: Date,
): boolean {
  if (actor.canEditRegistrants) return true;
  return checkedIn.by === actor.userId && now.getTime() - checkedIn.at.getTime() <= UNDO_WINDOW_MS;
}

/** Before the event day (in the event's time zone) a scan only shows its result and stores nothing. */
export function isPracticeTime(event: { startsAt: Date; timezone: string }, now: Date): boolean {
  return (
    utcToWallTime(now, event.timezone).slice(0, 10) <
    utcToWallTime(event.startsAt, event.timezone).slice(0, 10)
  );
}
