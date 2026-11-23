import { randomUUID } from "node:crypto";
import type { AuditEvent, Snapshot } from "@website/audit";
import { ConcurrencyConflictError } from "@website/domain/shared";
import {
  DEFAULT_AI_SETTINGS,
  type AiFeature,
  type AiSettings,
  type AiUsageRow,
} from "@website/domain/ai";
import { createSqlAuditWriter } from "./audit";
import { toDate } from "./slugged";
import type { Database } from "./store";

const num = (value: unknown) => (typeof value === "number" ? value : 0);

export function createSqlAiStore(db: Database) {
  const settingsRef = db.collection("settings").doc("ai");
  const usage = db.collection("aiUsage");
  const audit = createSqlAuditWriter(db);

  const parse = (data: Record<string, unknown> | undefined) => ({
    settings: {
      ...DEFAULT_AI_SETTINGS,
      models: (data?.["models"] ?? {}) as AiSettings["models"],
    } satisfies AiSettings,
    version: (data?.["version"] ?? null) as number | null,
  });

  return {
    readSettings: async () => parse((await settingsRef.get()).data()),

    async saveSettings(
      settings: AiSettings,
      expectedVersion: number | null,
      auditFor: (before: Snapshot, after: Snapshot, version: number) => AuditEvent,
    ): Promise<number> {
      return db.runTransaction(async (tx) => {
        const current = parse((await tx.get(settingsRef)).data());
        if (current.version !== expectedVersion)
          throw new ConcurrencyConflictError("ai settings changed");
        const version = (current.version ?? 0) + 1;
        const log = await audit.begin(tx);
        tx.set(settingsRef, { models: settings.models, version });
        log.append(auditFor({ ...current.settings.models }, { ...settings.models }, version));
        return version;
      });
    },

    /** Token counts only: never the prompt or the answer. */
    async recordUsage(row: AiUsageRow): Promise<void> {
      await usage.doc(randomUUID()).set({ ...row });
    },

    // shortcut: loads the whole range; fine for a few hundred drafts a month, page it if AI use grows.
    async usageBetween(from: Date, to: Date): Promise<AiUsageRow[]> {
      const found = await usage.where("at", ">=", from).where("at", "<", to).get();
      return found.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        return {
          feature: d["feature"] as AiFeature,
          model: String(d["model"]),
          uid: String(d["uid"]),
          at: toDate(d["at"]) as Date,
          input: num(d["input"]),
          output: num(d["output"]),
          cacheWrite: num(d["cacheWrite"]),
          cacheRead: num(d["cacheRead"]),
        };
      });
    },
  };
}
export type SqlAiStore = ReturnType<typeof createSqlAiStore>;
