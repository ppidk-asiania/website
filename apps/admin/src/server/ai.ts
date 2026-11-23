import "server-only";
import type { SqlAiStore } from "@website/db/sql";
import { AI_FEATURES, AiSettingsInputSchema, modelFor, summarizeUsage } from "@website/domain/ai";
import { createGuardedAction } from "./guarded-action";

export function createAiActions(deps: { readonly ai: Pick<SqlAiStore, "saveSettings"> }) {
  const saveSettings = createGuardedAction({
    permission: "ai.edit",
    input: AiSettingsInputSchema,
    handler: async ({ models, version }, _principal, audit) => ({
      version: await deps.ai.saveSettings({ models }, version, (before, after, next) =>
        audit({
          module: "ai",
          action: "UPDATE",
          resourceType: "settings",
          resourceId: "ai",
          title: "AI models",
          before,
          after,
          versionBefore: version,
          versionAfter: next,
          revertible: false,
        }),
      ),
    }),
  });
  return { saveSettings };
}

const monthStart = (at: Date, back = 0) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - back, 1));

/** Everything the dashboard card shows. The key itself never leaves this function. */
export async function aiCard(deps: {
  readonly ai: Pick<SqlAiStore, "readSettings" | "usageBetween">;
  readonly env: Readonly<Record<string, unknown>>;
  readonly now: Date;
}) {
  const [{ settings, version }, rows] = await Promise.all([
    deps.ai.readSettings(),
    deps.ai.usageBetween(monthStart(deps.now, 1), monthStart(deps.now, -1)),
  ]);
  const key = deps.env["ANTHROPIC_API_KEY"];
  const override = deps.env["ANTHROPIC_MODEL"];
  const thisMonth = monthStart(deps.now).getTime();
  return {
    keyTail: typeof key === "string" && key ? key.slice(-4) : null,
    version,
    models: Object.fromEntries(
      AI_FEATURES.map((f) => [
        f,
        modelFor(f, settings, typeof override === "string" ? override : undefined),
      ]),
    ) as Record<(typeof AI_FEATURES)[number], string>,
    thisMonth: summarizeUsage(rows.filter((r) => r.at.getTime() >= thisMonth)),
    lastMonth: summarizeUsage(rows.filter((r) => r.at.getTime() < thisMonth)),
  };
}
