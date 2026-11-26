import { RuleViolationError } from "../shared";
import type { EventEntity } from "./index";

export const EVENT_LOCK_DAYS = 14;
const DAY_MS = 86_400_000;

type Timing = Pick<EventEntity, "startsAt" | "endsAt">;
type Visibility = Pick<EventEntity, "published" | "deletedAt" | "publishAt">;

/** The instant an event is over: its end, or its start when no end is set. */
export const eventEnd = (e: Timing): Date => e.endsAt ?? e.startsAt;

/** "Past" = ended, or started and no end set. One rule for the lists, the home page and the event page. */
export const isPast = (e: Timing, now: Date): boolean => now >= eventEnd(e);

/** Published, not deleted and not waiting for its publish time (read-time rule, no job). */
export const isLive = (e: Visibility, now: Date): boolean =>
  e.published && e.deletedAt === null && (e.publishAt === null || e.publishAt <= now);

export const EVENT_STAGES = ["preparing", "public", "running", "after", "locked"] as const;
export type EventStage = (typeof EVENT_STAGES)[number];

export function eventStage(e: Timing & Visibility, now: Date): EventStage {
  if (!isLive(e, now)) return "preparing";
  if (now < e.startsAt) return "public";
  if (!isPast(e, now)) return "running";
  return now.getTime() < eventEnd(e).getTime() + EVENT_LOCK_DAYS * DAY_MS ? "after" : "locked";
}

type Approval = Pick<
  EventEntity,
  "approvalRequestedAt" | "approvalRequestedBy" | "approvedAt" | "approvedBy" | "rejectionNote"
>;
export const NO_APPROVAL: Approval = {
  approvalRequestedAt: null,
  approvalRequestedBy: null,
  approvedAt: null,
  approvedBy: null,
  rejectionNote: null,
};

export type ApprovalState = "none" | "pending" | "approved" | "rejected";
export function approvalState(e: Approval): ApprovalState {
  if (e.approvedAt !== null) return "approved";
  if (e.approvalRequestedAt !== null) return "pending";
  return e.rejectionNote !== null ? "rejected" : "none";
}

export function askForApproval(e: Approval, uid: string, now: Date): Approval {
  const state = approvalState(e);
  if (state === "approved") throw new RuleViolationError("This event is already approved.");
  if (state === "pending") throw new RuleViolationError("An approval request is already waiting.");
  return { ...NO_APPROVAL, approvalRequestedAt: now, approvalRequestedBy: uid };
}

export function approveEvent(e: Approval, uid: string, now: Date): Approval {
  if (approvalState(e) !== "pending")
    throw new RuleViolationError("There is no request to decide.");
  return { ...e, approvedAt: now, approvedBy: uid, rejectionNote: null };
}

/** A rejected request is an ordinary draft again; the reason stays on the event and in the audit entry. */
export function rejectEvent(e: Approval, note: string): Approval {
  if (approvalState(e) !== "pending")
    throw new RuleViolationError("There is no request to decide.");
  return { ...NO_APPROVAL, rejectionNote: note };
}

/**
 * Only an approved event can go public. While a request waits, nobody publishes: the decision goes
 * through Approve or Reject so the asker is told. A holder of `events.publish` approves by publishing.
 */
export function approvalToPublish(
  e: Approval | null,
  holder: boolean,
  uid: string,
  now: Date,
): Approval {
  const current = e ?? NO_APPROVAL;
  const state = approvalState(current);
  if (state === "pending") throw new RuleViolationError("Decide the approval request first.");
  if (state === "approved") return current;
  if (!holder) throw new RuleViolationError("Ask for approval first: the board publishes events.");
  return { ...current, approvedAt: now, approvedBy: uid, rejectionNote: null };
}

export function assertPublishAt(publishAt: Date | null, startsAt: Date): void {
  if (publishAt !== null && publishAt >= startsAt) {
    throw new RuleViolationError("Choose a publish time before the event starts.");
  }
}

export function cancelEvent(
  e: Pick<EventEntity, "cancelledAt">,
  reason: string,
  now: Date,
): Pick<EventEntity, "cancelledAt" | "cancelReason"> {
  if (e.cancelledAt !== null) throw new RuleViolationError("This event is already cancelled.");
  return { cancelledAt: now, cancelReason: reason };
}
