import "server-only";
import { z } from "zod";
import type { SqlCommitteeStore, SqlEventStore, SqlFormStore } from "@website/db/sql";
import {
  CommitteeInputSchema,
  DEFAULT_EVALUATION,
  PlacementSchema,
  committeeLocked,
  committeeRole,
  type CommitteeRole,
  type EventEntity,
} from "@website/domain/events";
import { isSignedInMode } from "@website/domain/forms";
import { RuleViolationError } from "@website/domain/shared";
import { safeId, safeText } from "@website/security/validation";
import type { Principal } from "@website/permissions";
import { createGuardedAction } from "./guarded-action";

export interface CommitteeDeps {
  readonly events: Pick<SqlEventStore, "get">;
  /** The seat of an account on this event now (the event board is allowed to place applicants). */
  readonly committeeRole: (userId: string, eventId: string) => Promise<CommitteeRole | null>;
  readonly committees: Pick<SqlCommitteeStore, "get" | "save" | "decide" | "decisionsOf">;
  readonly forms: Pick<SqlFormStore, "get" | "listResponses" | "getVersion">;
  /** The account that uses this e-mail, so a volunteer who has an account gets a real seat. */
  readonly accountByEmail: (email: string) => Promise<{ uid: string } | null>;
  readonly notify: {
    placed(
      event: EventEntity,
      uid: string,
      placement: { seat: string; division: string } | null,
    ): Promise<void>;
  };
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
        applicationForms: stored?.applicationForms ?? [],
        evaluation: stored?.evaluation ?? DEFAULT_EVALUATION,
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
      for (const link of committee.applicationForms) {
        const form = await deps.forms.get(link.formId);
        if (!form || form.deletedAt !== null || form.usage !== "public") {
          throw new RuleViolationError("Link a public form of the Forms page.");
        }
        if (link.kind === "committee" && !isSignedInMode(form.respondents)) {
          throw new RuleViolationError("A committee application is answered with an account.");
        }
      }
      const { evaluation } = committee;
      for (const [id, byAccount] of [
        [evaluation.formId, false],
        [evaluation.committeeFormId, true],
      ] as const) {
        if (id === null) continue;
        const form = await deps.forms.get(id);
        if (!form || form.deletedAt !== null || form.usage !== "public") {
          throw new RuleViolationError("Link a public form of the Forms page.");
        }
        // The committee roster is checked against the account that answers.
        if (byAccount && !isSignedInMode(form.respondents)) {
          throw new RuleViolationError("The committee evaluation is answered with an account.");
        }
      }
      return deps.committees.save(
        eventId,
        version,
        {
          evaluation,
          applicationForms: committee.applicationForms,
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

  // The event board and `events.edit` read and place applicants; nobody places themselves.
  const board = async (principal: Principal, { eventId }: { eventId: string }) =>
    (await deps.committeeRole(principal.userId, eventId)) === "board";
  const Place = Load.extend({
    formId: safeId,
    responseId: safeId,
    placement: PlacementSchema,
  }).strict();

  const applicants = createGuardedAction({
    permission: "events.edit",
    orIf: board,
    input: Load,
    handler: async ({ eventId }) => {
      await liveEvent(eventId);
      const [committee, decided] = await Promise.all([
        deps.committees.get(eventId),
        deps.committees.decisionsOf(eventId),
      ]);
      return Promise.all(
        (committee?.applicationForms ?? []).map(async (link) => {
          const form = await deps.forms.get(link.formId);
          const responses = form ? await deps.forms.listResponses(link.formId, 200) : [];
          const versions = new Map<number, Awaited<ReturnType<typeof deps.forms.getVersion>>>();
          for (const r of responses) {
            if (!versions.has(r.version))
              versions.set(r.version, await deps.forms.getVersion(link.formId, r.version));
          }
          return {
            formId: link.formId,
            kind: link.kind,
            title: form?.title ?? "(deleted form)",
            rows: responses.map((r) => {
              const d = decided.get(r.id);
              return {
                responseId: r.id,
                name: r.name ?? "",
                email: r.email ?? "",
                submittedAt: r.submittedAt.toISOString(),
                answers: (versions.get(r.version)?.questions ?? []).flatMap((q) => {
                  const a = r.answers[q.id];
                  return a === undefined || (typeof a === "object" && !Array.isArray(a))
                    ? []
                    : [{ label: q.label, value: Array.isArray(a) ? a.join(", ") : String(a) }];
                }),
                outcome: d?.outcome ?? null,
                divisionId: d?.divisionId ?? null,
                seat: d?.seat ?? null,
              };
            }),
          };
        }),
      );
    },
  });

  const place = createGuardedAction({
    permission: "events.edit",
    orIf: board,
    input: Place,
    handler: async ({ eventId, formId, responseId, placement }, principal, audit) => {
      const event = await liveEvent(eventId);
      const now = deps.now();
      if (committeeLocked(event, now)) {
        throw new RuleViolationError("The committee is locked 14 days after the event.");
      }
      const committee = await deps.committees.get(eventId);
      if (!committee?.applicationForms.some((f) => f.formId === formId)) {
        throw new RuleViolationError("This form is not linked to the committee.");
      }
      const response = (await deps.forms.listResponses(formId, 500)).find(
        (r) => r.id === responseId,
      );
      if (!response) throw new RuleViolationError("This answer does not exist.");
      if (response.uid === principal.userId) {
        throw new RuleViolationError("Someone else must place you.");
      }
      const named = response.name || response.email || "";
      const uid =
        response.uid ??
        (response.email ? ((await deps.accountByEmail(response.email))?.uid ?? null) : null);
      if (uid === principal.userId) throw new RuleViolationError("Someone else must place you.");
      if (placement.outcome === "placed" && named === "") {
        throw new RuleViolationError("This answer has no name to put on the committee.");
      }
      await deps.committees.decide(
        eventId,
        { responseId, formId, userId: uid, name: named },
        placement,
        principal.userId,
        (before, after, versions) =>
          audit({
            module: "events",
            action: "UPDATE",
            resourceType: "eventCommittee",
            resourceId: eventId,
            title: placement.outcome === "placed" ? "Applicant placed" : "Applicant rejected",
            before,
            after,
            versionBefore: versions.before,
            versionAfter: versions.after,
            revertible: false,
          }),
        now,
      );
      if (uid) {
        const division = committee.divisions.find(
          (d) => placement.outcome === "placed" && d.id === placement.divisionId,
        );
        await deps.notify.placed(
          event,
          uid,
          placement.outcome === "placed" && division
            ? { seat: placement.seat, division: division.name }
            : null,
        );
      }
      return { placed: placement.outcome === "placed" };
    },
  });

  return { load, save, findPeople, applicants, place };
}
