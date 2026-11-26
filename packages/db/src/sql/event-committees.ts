import type { Database } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import type {
  ApplicationForm,
  CommitteeMember,
  Division,
  EventCommittee,
  Placement,
} from "@website/domain/events";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";

export interface StoredCommittee extends EventCommittee {
  readonly eventId: string;
  readonly version: number;
  readonly applicationForms: readonly ApplicationForm[];
}

export type CommitteeAudit = (
  before: Snapshot | null,
  after: Snapshot,
  version: { before: number | null; after: number },
) => AuditEvent;

const snapshotOf = (c: EventCommittee): Snapshot => ({
  divisions: c.divisions.map((d) => ({ ...d })),
  members: c.members.map((m) => ({ ...m })),
  applicationForms: (c.applicationForms ?? []).map((f) => ({ ...f })),
});

export interface StoredDecision {
  readonly responseId: string;
  readonly formId: string;
  readonly outcome: Placement["outcome"];
  readonly divisionId: string | null;
  readonly seat: string | null;
}

/** One document per event (id = event id): the divisions and the people with a seat. */
export function createSqlCommitteeStore(db: Database) {
  const docs = db.collection("eventCommittees");
  const decisions = db.collection("eventApplicants");
  const audit = createSqlAuditWriter(db);
  const read = (id: string, doc: { get(field: string): unknown }): StoredCommittee => ({
    eventId: id,
    version: (doc.get("version") as number | undefined) ?? 1,
    divisions: (doc.get("divisions") as Division[] | undefined) ?? [],
    members: (doc.get("members") as CommitteeMember[] | undefined) ?? [],
    applicationForms: (doc.get("applicationForms") as ApplicationForm[] | undefined) ?? [],
  });
  return {
    async get(eventId: string): Promise<StoredCommittee | null> {
      const snap = await docs.doc(safeId.parse(eventId)).get();
      return snap.exists ? read(snap.id, snap) : null;
    },

    /** Every committee (an event has one), to find the events a person serves on. */
    async listAll(limit = 1000): Promise<StoredCommittee[]> {
      const snapshot = await docs.limit(limit).get();
      return snapshot.docs.map((doc) => read(doc.id, doc));
    },

    /** Replaces the whole committee; `expectedVersion` is null for the first save. */
    save(
      eventId: string,
      expectedVersion: number | null,
      committee: EventCommittee,
      auditFor: CommitteeAudit,
      now: Date,
    ): Promise<{ version: number }> {
      return db.runTransaction(async (tx) => {
        const ref = docs.doc(safeId.parse(eventId));
        const snap = await tx.get(ref);
        const current = snap.exists ? read(snap.id, snap) : null;
        if ((current?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError("eventCommittees version changed");
        }
        const version = (current?.version ?? 0) + 1;
        const log = await audit.begin(tx);
        tx.set(ref, {
          divisions: committee.divisions.map((d) => ({ ...d })),
          members: committee.members.map((m) => ({ ...m })),
          applicationForms: (committee.applicationForms ?? []).map((f) => ({ ...f })),
          version,
          updatedAt: now,
        });
        log.append(
          auditFor(current && snapshotOf(current), snapshotOf(committee), {
            before: current?.version ?? null,
            after: version,
          }),
        );
        return { version };
      });
    },

    /** What was decided for the applicants of an event, by response id. */
    async decisionsOf(eventId: string): Promise<Map<string, StoredDecision>> {
      const snapshot = await decisions.where("eventId", "==", safeId.parse(eventId)).get();
      return new Map(
        snapshot.docs.map((doc) => [
          doc.get("responseId") as string,
          {
            responseId: doc.get("responseId") as string,
            formId: doc.get("formId") as string,
            outcome: doc.get("outcome") as Placement["outcome"],
            divisionId: (doc.get("divisionId") as string | null | undefined) ?? null,
            seat: (doc.get("seat") as string | null | undefined) ?? null,
          },
        ]),
      );
    },

    /**
     * Decides one applicant once. A placement writes the seat into the committee in the same transaction, so
     * an answer is never placed twice and a person never holds two seats.
     */
    decide(
      eventId: string,
      applicant: { responseId: string; formId: string; userId: string | null; name: string },
      placement: Placement,
      by: string,
      auditFor: CommitteeAudit,
      now: Date,
    ): Promise<void> {
      return db.runTransaction(async (tx) => {
        const decisionRef = decisions.doc(
          `${safeId.parse(eventId)}_${safeId.parse(applicant.responseId)}`,
        );
        const ref = docs.doc(safeId.parse(eventId));
        const [decided, snap] = await Promise.all([tx.get(decisionRef), tx.get(ref)]);
        if (decided.exists) throw new RuleViolationError("This answer was already decided.");
        const current = snap.exists ? read(snap.id, snap) : null;
        if (placement.outcome === "placed") {
          if (!current?.divisions.some((d) => d.id === placement.divisionId)) {
            throw new RuleViolationError("Choose a division of this committee.");
          }
          const typed = applicant.name.trim().toLowerCase();
          const seated = current.members.some((m) =>
            applicant.userId
              ? m.userId === applicant.userId
              : !m.userId && m.name.toLowerCase() === typed,
          );
          if (seated)
            throw new RuleViolationError("This person already has a seat on the committee.");
          const version = current.version + 1;
          const members = [
            ...current.members,
            {
              userId: applicant.userId,
              name: applicant.userId ? "" : applicant.name.trim(),
              divisionId: placement.divisionId,
              seat: placement.seat,
            },
          ];
          const log = await audit.begin(tx);
          tx.set(ref, {
            divisions: current.divisions.map((d) => ({ ...d })),
            members,
            applicationForms: current.applicationForms.map((f) => ({ ...f })),
            version,
            updatedAt: now,
          });
          log.append(
            auditFor(snapshotOf(current), snapshotOf({ ...current, members }), {
              before: current.version,
              after: version,
            }),
          );
        }
        tx.set(decisionRef, {
          eventId,
          formId: applicant.formId,
          responseId: applicant.responseId,
          outcome: placement.outcome,
          divisionId: placement.outcome === "placed" ? placement.divisionId : null,
          seat: placement.outcome === "placed" ? placement.seat : null,
          decidedBy: by,
          decidedAt: now,
        });
      });
    },
  };
}
export type SqlCommitteeStore = ReturnType<typeof createSqlCommitteeStore>;
