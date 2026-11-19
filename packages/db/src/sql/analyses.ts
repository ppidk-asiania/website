import type { AuditEvent } from "@website/audit";
import type { AnalysisStatus, ApplicationAnalysis, ProofCheck } from "@website/domain/recruitment";
import { RuleViolationError } from "@website/domain/shared";
import { createSqlAuditWriter } from "./audit";
import { toDate } from "./slugged";
import type { Database } from "./store";

type Doc = Record<string, unknown>;
const toAnalysis = (id: string, d: Doc): ApplicationAnalysis => ({
  id,
  applicationId: d["applicationId"] as string,
  status: d["status"] as AnalysisStatus,
  requestedBy: d["requestedBy"] as string,
  requestedAt: toDate(d["requestedAt"]) as Date,
  startedAt: toDate(d["startedAt"]),
  finishedAt: toDate(d["finishedAt"]),
  result: (d["result"] as ApplicationAnalysis["result"] | null | undefined) ?? null,
  skipped: (d["skipped"] as ApplicationAnalysis["skipped"] | undefined) ?? [],
  error: (d["error"] as string | null | undefined) ?? null,
});
const toCheck = (id: string, d: Doc): ProofCheck => ({
  id,
  uid: d["uid"] as string,
  by: d["by"] as string,
  at: toDate(d["at"]) as Date,
  result: d["result"] as ProofCheck["result"],
});

/** `in` takes at most 30 values per query. */
const chunks = <T>(items: readonly T[]) =>
  Array.from({ length: Math.ceil(items.length / 30) }, (_, i) => items.slice(i * 30, i * 30 + 30));

/** Application analyses (a queue worked by the `ai-jobs` cron job) and the proof-check history (step 11.9). */
export function createSqlAnalysisStore(db: Database) {
  const analyses = db.collection("applicationAnalyses");
  const checks = db.collection("proofChecks");
  const audit = createSqlAuditWriter(db);

  // The audit entry goes in the same transaction as the change; reads first, then writes.
  const change = (id: string, patch: Doc, event: AuditEvent) =>
    db.runTransaction(async (tx) => {
      const log = await audit.begin(tx);
      tx.update(analyses.doc(id), patch);
      log.append(event);
    });

  return {
    queue(row: ApplicationAnalysis, event: AuditEvent): Promise<void> {
      return db.runTransaction(async (tx) => {
        const waiting = await tx.get(
          analyses
            .where("applicationId", "==", row.applicationId)
            .where("status", "==", "queued")
            .limit(1),
        );
        if (!waiting.empty) {
          throw new RuleViolationError("An analysis is already waiting for this application.");
        }
        const log = await audit.begin(tx);
        const { id, ...doc } = row;
        tx.create(analyses.doc(id), doc);
        log.append(event);
      });
    },

    /** The oldest queued row becomes `running` in one transaction (rows are locked), so two calls never share one. */
    claimNext(now: Date): Promise<ApplicationAnalysis | null> {
      return db.runTransaction(async (tx) => {
        const found = await tx.get(
          analyses.where("status", "==", "queued").orderBy("requestedAt").limit(1),
        );
        const doc = found.docs[0];
        if (!doc) return null;
        tx.update(analyses.doc(doc.id), { status: "running", startedAt: now });
        return { ...toAnalysis(doc.id, doc.data()), status: "running", startedAt: now };
      });
    },

    finish(
      id: string,
      done: Pick<ApplicationAnalysis, "result" | "skipped">,
      now: Date,
      event: AuditEvent,
    ) {
      return change(id, { status: "done", finishedAt: now, ...done, error: null }, event);
    },

    fail(id: string, error: string, now: Date, event: AuditEvent) {
      return change(id, { status: "failed", finishedAt: now, error }, event);
    },

    /** The newest run of each application. */
    async latestFor(applicationIds: readonly string[]): Promise<Map<string, ApplicationAnalysis>> {
      const latest = new Map<string, ApplicationAnalysis>();
      for (const ids of chunks(applicationIds)) {
        for (const doc of (await analyses.where("applicationId", "in", ids).get()).docs) {
          const row = toAnalysis(doc.id, doc.data());
          const seen = latest.get(row.applicationId);
          if (!seen || seen.requestedAt < row.requestedAt) latest.set(row.applicationId, row);
        }
      }
      return latest;
    },

    async addProofCheck(check: ProofCheck, event: AuditEvent): Promise<void> {
      await db.runTransaction(async (tx) => {
        const log = await audit.begin(tx);
        const { id, ...doc } = check;
        tx.create(checks.doc(id), doc);
        log.append(event);
      });
    },

    /** The newest check of each member (older ones stay in the collection as history). */
    async latestChecks(uids: readonly string[]): Promise<Map<string, ProofCheck>> {
      const latest = new Map<string, ProofCheck>();
      for (const ids of chunks(uids)) {
        for (const doc of (await checks.where("uid", "in", ids).get()).docs) {
          const row = toCheck(doc.id, doc.data());
          const seen = latest.get(row.uid);
          if (!seen || seen.at < row.at) latest.set(row.uid, row);
        }
      }
      return latest;
    },
  };
}
export type SqlAnalysisStore = ReturnType<typeof createSqlAnalysisStore>;
