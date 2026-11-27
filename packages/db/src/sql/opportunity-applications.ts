import type { AuditEvent, Snapshot } from "@website/audit";
import {
  applicationId,
  assertCanApplyOnPlatform,
  canMoveTo,
  type ApplicationStatus,
  type OpportunityApplication,
} from "@website/domain/opportunities";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { toOpportunity } from "./opportunities";
import { toDate } from "./slugged";
import type { Database } from "./store";

type Doc = { get(field: string): unknown };

function toApplication(id: string, doc: Doc): OpportunityApplication {
  return {
    id,
    opportunityId: doc.get("opportunityId") as string,
    userId: doc.get("userId") as string,
    coverLetter: doc.get("coverLetter") as string,
    cvPath: doc.get("cvPath") as string,
    status: doc.get("status") as ApplicationStatus,
    note: (doc.get("note") as string | null | undefined) ?? null,
    createdAt: toDate(doc.get("createdAt")) as Date,
    updatedAt: toDate(doc.get("updatedAt")) as Date,
  };
}

/** What an audit entry keeps of an application: the state, not the letter or the file. */
const applicationSnapshot = (a: OpportunityApplication): Snapshot => ({
  opportunityId: a.opportunityId,
  userId: a.userId,
  status: a.status,
  note: a.note,
});

export type OpportunityApplicationAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  application: OpportunityApplication,
) => AuditEvent;

const MAX_LIST = 5000;

/** Web side: an account applies once to a posting and reads its own applications. */
export function createSqlOpportunityApplicationWebStore(db: Database) {
  const applications = db.collection("opportunityApplications");
  return {
    /** The posting is read in the same transaction, so a closed one never takes an application. */
    async apply(
      opportunityId: string,
      userId: string,
      input: { coverLetter: string; cvPath: string },
      now: Date,
      today: string,
    ): Promise<void> {
      const ref = applications.doc(safeId.parse(applicationId(opportunityId, userId)));
      const postingRef = db.collection("opportunities").doc(safeId.parse(opportunityId));
      await db.runTransaction(async (tx) => {
        const posting = await tx.get(postingRef);
        if (!posting.exists) throw new RuleViolationError("This posting does not exist.");
        assertCanApplyOnPlatform(toOpportunity(posting.id, posting.data() ?? {}), today);
        if ((await tx.get(ref)).exists) {
          throw new RuleViolationError("You already applied to this posting.");
        }
        tx.create(ref, {
          opportunityId,
          userId,
          coverLetter: input.coverLetter,
          cvPath: input.cvPath,
          status: "submitted",
          note: null,
          createdAt: now,
          updatedAt: now,
        });
      });
    },
    /** Only this account's rows: the account id is the filter, never a parameter of the request. */
    async mine(userId: string): Promise<OpportunityApplication[]> {
      const snapshot = await applications.where("userId", "==", userId).limit(MAX_LIST).get();
      return snapshot.docs
        .map((doc) => toApplication(doc.id, doc))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  };
}
export type SqlOpportunityApplicationWebStore = ReturnType<
  typeof createSqlOpportunityApplicationWebStore
>;

/** Admin side: the applicants of a posting, their status and note, and one delete. */
export function createSqlOpportunityApplicationStore(db: Database) {
  const applications = db.collection("opportunityApplications");
  const audit = createSqlAuditWriter(db);
  return {
    async get(id: string): Promise<OpportunityApplication | null> {
      if (!safeId.safeParse(id).success) return null;
      const doc = await applications.doc(id).get();
      return doc.exists ? toApplication(doc.id, doc) : null;
    },
    async forOpportunity(opportunityId: string): Promise<OpportunityApplication[]> {
      const snapshot = await applications
        .where("opportunityId", "==", opportunityId)
        .limit(MAX_LIST)
        .get();
      return snapshot.docs
        .map((doc) => toApplication(doc.id, doc))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    /** Applicants per posting, for the list. */
    async counts(): Promise<Map<string, number>> {
      const snapshot = await applications.limit(MAX_LIST).get();
      const counts = new Map<string, number>();
      for (const doc of snapshot.docs) {
        const id = doc.get("opportunityId") as string;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return counts;
    },
    /** A new status (only a step the chain allows) and/or the internal note, with one audit entry. */
    review(
      id: string,
      change: { status: ApplicationStatus | null; note: string },
      now: Date,
      auditFor: OpportunityApplicationAudit,
    ): Promise<{ before: OpportunityApplication; after: OpportunityApplication }> {
      return db.runTransaction(async (tx) => {
        const ref = applications.doc(safeId.parse(id));
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This application does not exist.");
        const before = toApplication(ref.id, snapshot);
        if (change.status !== null && !canMoveTo(before.status, change.status)) {
          throw new RuleViolationError("This status cannot follow the current one.");
        }
        const after: OpportunityApplication = {
          ...before,
          status: change.status ?? before.status,
          note: change.note || null,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.update(ref, { status: after.status, note: after.note, updatedAt: now });
        log.append(auditFor(applicationSnapshot(before), applicationSnapshot(after), after));
        return { before, after };
      });
    },
    remove(id: string, auditFor: OpportunityApplicationAudit): Promise<OpportunityApplication> {
      return db.runTransaction(async (tx) => {
        const ref = applications.doc(safeId.parse(id));
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This application does not exist.");
        const before = toApplication(ref.id, snapshot);
        const log = await audit.begin(tx);
        tx.delete(ref);
        log.append(auditFor(applicationSnapshot(before), null, before));
        return before;
      });
    },
  };
}
export type SqlOpportunityApplicationStore = ReturnType<
  typeof createSqlOpportunityApplicationStore
>;
