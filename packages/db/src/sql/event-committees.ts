import type { Database } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import type { CommitteeMember, Division, EventCommittee } from "@website/domain/events";
import { ConcurrencyConflictError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";

export interface StoredCommittee extends EventCommittee {
  readonly eventId: string;
  readonly version: number;
}

export type CommitteeAudit = (
  before: Snapshot | null,
  after: Snapshot,
  version: { before: number | null; after: number },
) => AuditEvent;

const snapshotOf = (c: EventCommittee): Snapshot => ({
  divisions: c.divisions.map((d) => ({ ...d })),
  members: c.members.map((m) => ({ ...m })),
});

/** One document per event (id = event id): the divisions and the people with a seat. */
export function createSqlCommitteeStore(db: Database) {
  const docs = db.collection("eventCommittees");
  const audit = createSqlAuditWriter(db);
  const read = (id: string, doc: { get(field: string): unknown }): StoredCommittee => ({
    eventId: id,
    version: (doc.get("version") as number | undefined) ?? 1,
    divisions: (doc.get("divisions") as Division[] | undefined) ?? [],
    members: (doc.get("members") as CommitteeMember[] | undefined) ?? [],
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
  };
}
export type SqlCommitteeStore = ReturnType<typeof createSqlCommitteeStore>;
