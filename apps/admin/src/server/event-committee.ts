import "server-only";
import { z } from "zod";
import type { SqlCommitteeStore, SqlEventStore } from "@website/db/sql";
import {
  CommitteeInputSchema,
  committeeRole,
  type CommitteeRole,
  type EventEntity,
} from "@website/domain/events";
import { RuleViolationError } from "@website/domain/shared";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

export interface CommitteeDeps {
  readonly events: Pick<SqlEventStore, "get">;
  readonly committees: Pick<SqlCommitteeStore, "get" | "save">;
  readonly users: (
    uids: readonly string[],
  ) => Promise<ReadonlyMap<string, { name: string | null; email: string | null }>>;
  readonly findPeople: (
    query: string,
  ) => Promise<Array<{ uid: string; name: string | null; email: string | null }>>;
  readonly now: () => Date;
}

const Load = z.object({ eventId: safeId }).strict();

/** What the account may do on this event from its seat now (null: nothing). Recomputed on every request. */
export function createCommitteeRoles(deps: Pick<CommitteeDeps, "events" | "committees" | "now">) {
  return async (userId: string, eventId: string): Promise<CommitteeRole | null> => {
    if (!safeId.safeParse(eventId).success) return null;
    const [event, committee] = await Promise.all([
      deps.events.get(eventId),
      deps.committees.get(eventId),
    ]);
    return event && event.deletedAt === null
      ? committeeRole(committee, userId, event, deps.now())
      : null;
  };
}

export function createCommitteeActions(deps: CommitteeDeps) {
  const liveEvent = async (eventId: string): Promise<EventEntity> => {
    const event = await deps.events.get(eventId);
    if (!event || event.deletedAt !== null) {
      throw new RuleViolationError("This event does not exist.");
    }
    return event;
  };

  const load = createGuardedAction({
    permission: "events.edit",
    input: Load,
    handler: async ({ eventId }) => {
      await liveEvent(eventId);
      const stored = await deps.committees.get(eventId);
      const accounts = await deps.users(
        (stored?.members ?? []).flatMap((m) => (m.userId ? [m.userId] : [])),
      );
      return {
        version: stored?.version ?? null,
        divisions: stored?.divisions ?? [],
        members: (stored?.members ?? []).map((m) => ({
          ...m,
          shownName: m.userId ? (accounts.get(m.userId)?.name ?? "(unknown account)") : m.name,
        })),
      };
    },
  });

  const save = createGuardedAction({
    permission: "events.edit",
    input: Load.extend({
      version: z.number().int().min(1).nullable(),
      committee: CommitteeInputSchema,
    }).strict(),
    handler: async ({ eventId, version, committee }, _principal, audit) => {
      await liveEvent(eventId);
      const uids = committee.members.flatMap((m) => (m.userId ? [m.userId] : []));
      const accounts = await deps.users(uids);
      if (uids.some((uid) => !accounts.has(uid))) {
        throw new RuleViolationError("One of the accounts does not exist any more.");
      }
      return deps.committees.save(
        eventId,
        version,
        {
          divisions: committee.divisions,
          // The account's own name is shown, so none is copied next to it.
          members: committee.members.map((m) => ({ ...m, name: m.userId ? "" : m.name })),
        },
        (before, after, versions) =>
          audit({
            module: "events",
            action: before ? "UPDATE" : "CREATE",
            resourceType: "eventCommittee",
            resourceId: eventId,
            title: "Event committee",
            before,
            after,
            versionBefore: versions.before,
            versionAfter: versions.after,
            revertible: false,
          }),
        deps.now(),
      );
    },
  });

  /** Accounts to pick from, by name or e-mail (the same look-up the Role Manager uses). */
  const findPeople = createGuardedAction({
    permission: "events.edit",
    input: z.object({ query: safeText(120).pipe(z.string().min(2)) }).strict(),
    handler: async ({ query }) => deps.findPeople(query),
  });

  return { load, save, findPeople };
}
