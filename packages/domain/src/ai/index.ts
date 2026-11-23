import { z } from "zod";

export const AI_FEATURES = ["minutes", "proofCheck", "applicationAnalysis"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export interface AiModel {
  readonly id: string;
  readonly label: string;
  /** US dollars per million tokens. */
  readonly price: {
    readonly input: number;
    readonly output: number;
    readonly cacheWrite: number;
    readonly cacheRead: number;
  };
}

// Prices: platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-16 (5-minute cache write). Owner: re-check.
export const AI_MODELS: readonly AiModel[] = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    price: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    price: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  },
];

export const DEFAULT_AI_MODEL = "claude-sonnet-4-5";

const listed = (id: string | undefined): id is string => AI_MODELS.some((m) => m.id === id);
const modelId = z.string().refine(listed, "Choose one of the listed models.");

export type AiSettings = { readonly models: Readonly<Partial<Record<AiFeature, string>>> };
export const DEFAULT_AI_SETTINGS: AiSettings = { models: {} };

export const AiSettingsInputSchema = z
  .object({
    models: z
      .object({ minutes: modelId, proofCheck: modelId, applicationAnalysis: modelId })
      .strict(),
    version: z.number().int().min(1).nullable(),
  })
  .strict();

/** The env override (local work) wins, but only when it is a listed model. */
export function modelFor(
  feature: AiFeature,
  settings: AiSettings | AiSettings["models"] | undefined,
  envOverride?: string,
): string {
  if (listed(envOverride)) return envOverride;
  const models = settings && "models" in settings ? settings.models : settings;
  const chosen = models?.[feature];
  return listed(chosen) ? chosen : DEFAULT_AI_MODEL;
}

export interface AiUsageRow {
  readonly feature: AiFeature;
  readonly model: string;
  readonly uid: string;
  readonly at: Date;
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

const tokensOf = (r: AiUsageRow) => r.input + r.output + r.cacheWrite + r.cacheRead;

/** Estimated US dollars, or null when the model has no known price (never 0). */
export function costOf(row: AiUsageRow): number | null {
  const price = AI_MODELS.find((m) => m.id === row.model)?.price;
  if (!price) return null;
  return (
    (row.input * price.input +
      row.output * price.output +
      row.cacheWrite * price.cacheWrite +
      row.cacheRead * price.cacheRead) /
    1_000_000
  );
}

export function summarizeUsage(rows: readonly AiUsageRow[]) {
  let cost = 0;
  const unpriced = new Map<string, { model: string; requests: number; tokens: number }>();
  for (const row of rows) {
    const c = costOf(row);
    if (c !== null) cost += c;
    else {
      const seen = unpriced.get(row.model) ?? { model: row.model, requests: 0, tokens: 0 };
      unpriced.set(row.model, {
        ...seen,
        requests: seen.requests + 1,
        tokens: seen.tokens + tokensOf(row),
      });
    }
  }
  return {
    requests: rows.length,
    tokens: rows.reduce((sum, r) => sum + tokensOf(r), 0),
    cost,
    unpriced: [...unpriced.values()],
  };
}
