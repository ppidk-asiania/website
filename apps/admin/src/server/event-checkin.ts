import "server-only";
import { z } from "zod";
import type { CheckInAudit, SqlEventStore, SqlRegistrationStore } from "@website/db/sql";
import {
  canUndoCheckIn,
  checkInOutcome,
  isPracticeTime,
  registrationId,
  type CheckInMethod,
  type CheckInOutcome,
  type CommitteeRole,
} from "@website/domain/events";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal } from "@website/permissions";
import { sha256Hex } from "@website/security";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface CheckInDeps {
  readonly events: Pick<SqlEventStore, "get">;
  readonly registrations: Pick<
    SqlRegistrationStore,
    "findByTicketHash" | "checkIn" | "undoCheckIn" | "listForEvent"
  >;
  readonly users: (
    uids: readonly string[],
  ) => Promise<ReadonlyMap<string, { name: string | null; email: string | null }>>;
  /** The seat of an account on this event now (N1.5): any seat may scan and check people in. */
  readonly committeeRole: (userId: string, eventId: string) => Promise<CommitteeRole | null>;
  readonly now: () => Date;
}

/** The hash a ticket is stored under: the QR carries the token, the database only its hash. */
export const ticketHash = (token: string) => sha256Hex(new TextEncoder().encode(token));

export interface Attendee {
  readonly userId: string;
  readonly name: string;
  readonly category: string | null;
  /** Why the person can or cannot enter now. */
  readonly outcome: CheckInOutcome;
  readonly checkedInAt: string | null;
  readonly method: CheckInMethod | null;
  readonly canUndo: boolean;
}

export interface Card {
  readonly outcome: CheckInOutcome;
  readonly name: string | null;
  readonly category: string | null;
  readonly at: string | null;
  /** Practice: before the event day nothing is stored. */
  readonly practice: boolean;
}

const checkInAudit =
  (audit: AuditBuilder, eventId: string, userId: string, title: string): CheckInAudit =>
  (before, after) =>
    audit({
      module: "registrants",
      action: "UPDATE",
      resourceType: "eventRegistration",
      resourceId: registrationId(eventId, userId),
      title,
      before,
      after,
      versionBefore: null,
      versionAfter: null,
      revertible: false,
    });

export function createCheckInActions(deps: CheckInDeps) {
  /** Door staff hold `events.checkin` or sit on the event's committee; `registrants.edit` can do it all. */
  const gate = {
    permission: "events.checkin",
    orIf: async (principal: Principal, input: { eventId: string }) =>
      can(principal, "registrants.edit") ||
      (await deps.committeeRole(principal.userId, input.eventId)) !== null,
  } as const;

  const liveEvent = async (eventId: string) => {
    const event = await deps.events.get(eventId);
    if (!event || event.deletedAt !== null) {
      throw new RuleViolationError("This event does not exist.");
    }
    return event;
  };

  async function card(
    event: Awaited<ReturnType<typeof liveEvent>>,
    found: { userId: string } | null,
    by: string,
    method: CheckInMethod,
    audit: AuditBuilder,
  ): Promise<Card> {
    const now = deps.now();
    const practice = isPracticeTime(event, now);
    if (!found) return { outcome: "unknown", name: null, category: null, at: null, practice };
    const result = await deps.registrations.checkIn(
      registrationId(event.id, found.userId),
      event.id,
      by,
      method,
      now,
      checkInAudit(audit, event.id, found.userId, "Check-in"),
      practice,
    );
    const name = (await deps.users([found.userId])).get(found.userId)?.name ?? null;
    const category = event.fee?.categories.find((c) => c.id === result.category)?.label ?? null;
    return {
      outcome: result.outcome,
      name,
      category,
      at: result.at?.toISOString() ?? null,
      practice,
    };
  }

  /** The list for the scan page: counts first, then everyone who is registered. */
  const attendance = createGuardedAction({
    ...gate,
    input: z.object({ eventId: safeId }).strict(),
    handler: async ({ eventId }, principal) => {
      const event = await liveEvent(eventId);
      const rows = await deps.registrations.listForEvent(eventId);
      const users = await deps.users(rows.map((r) => r.userId));
      const canEditRegistrants = can(principal, "registrants.edit");
      const now = deps.now();
      const people = rows.map((r): Attendee => {
        const outcome = checkInOutcome(r);
        return {
          userId: r.userId,
          name: users.get(r.userId)?.name ?? "",
          category: event.fee?.categories.find((c) => c.id === r.feeCategory)?.label ?? null,
          outcome,
          checkedInAt: r.checkedInAt?.toISOString() ?? null,
          method: r.checkInMethod,
          canUndo:
            r.checkedInAt !== null &&
            canUndoCheckIn(
              { by: r.checkedInBy, at: r.checkedInAt },
              { userId: principal.userId, canEditRegistrants },
              now,
            ),
        };
      });
      // "Registered" = people who may enter: confirmed, and verified when the event is paid.
      const expected = people.filter((p) => p.outcome === "checked_in" || p.outcome === "already");
      return {
        title: event.title,
        practice: isPracticeTime(event, now),
        present: people.filter((p) => p.checkedInAt !== null).length,
        registered: expected.length,
        people: people.filter((p) => p.outcome !== "cancelled"),
      };
    },
  });

  /** A scanned ticket. A wrong, old or other-event token gets one neutral answer ("unknown"). */
  const scan = createGuardedAction({
    ...gate,
    input: z.object({ eventId: safeId, token: z.string().min(1).max(200) }).strict(),
    handler: async ({ eventId, token }, principal, audit) => {
      const event = await liveEvent(eventId);
      const found = await deps.registrations.findByTicketHash(ticketHash(token));
      return card(
        event,
        found && found.eventId === eventId ? found : null,
        principal.userId,
        "scan",
        audit,
      );
    },
  });

  /** Manual check-in from the list: the state is shown first; unpaid or cancelled has no button. */
  const checkIn = createGuardedAction({
    ...gate,
    input: z.object({ eventId: safeId, userId: safeId }).strict(),
    handler: async ({ eventId, userId }, principal, audit) =>
      card(await liveEvent(eventId), { userId }, principal.userId, "manual", audit),
  });

  const undo = createGuardedAction({
    ...gate,
    input: z.object({ eventId: safeId, userId: safeId }).strict(),
    handler: async ({ eventId, userId }, principal, audit) => {
      await liveEvent(eventId);
      await deps.registrations.undoCheckIn(
        registrationId(eventId, userId),
        eventId,
        { userId: principal.userId, canEditRegistrants: can(principal, "registrants.edit") },
        deps.now(),
        checkInAudit(audit, eventId, userId, "Check-in undone"),
      );
      return { undone: true };
    },
  });

  return { attendance, scan, checkIn, undo };
}
