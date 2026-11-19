import { describe, expect, it } from "vitest";
import {
  AI_FEATURES,
  AI_MODELS,
  AiSettingsInputSchema,
  costOf,
  modelFor,
  summarizeUsage,
  type AiUsageRow,
} from "@website/domain/ai";

const row = (over: Partial<AiUsageRow> = {}): AiUsageRow => ({
  feature: "minutes",
  model: "claude-sonnet-4-5",
  uid: "u1",
  at: new Date("2026-11-10T12:00:00Z"),
  input: 1_000_000,
  output: 100_000,
  cacheWrite: 0,
  cacheRead: 0,
  ...over,
});

describe("AI cost maths (step 10.5)", () => {
  it("offers exactly two models, a Sonnet and a Haiku, with all four prices", () => {
    expect(AI_MODELS.map((m) => m.id)).toEqual(["claude-sonnet-4-5", "claude-haiku-4-5"]);
    for (const m of AI_MODELS) {
      expect(Object.keys(m.price).sort()).toEqual(["cacheRead", "cacheWrite", "input", "output"]);
    }
  });

  it("prices a request per million tokens, cache included", () => {
    // 1M in at $3 + 0.1M out at $15
    expect(costOf(row())).toBeCloseTo(4.5);
    const haiku = row({ model: "claude-haiku-4-5", cacheWrite: 2_000_000, cacheRead: 10_000_000 });
    expect(costOf(haiku)).toBeCloseTo(1 + 0.5 + 2.5 + 1);
  });

  it("returns null, never zero, for a model without a known price", () => {
    expect(costOf(row({ model: "claude-old-1" }))).toBeNull();
  });

  it("sums priced rows and lists unpriced models apart", () => {
    const summary = summarizeUsage([
      row(),
      row({ input: 500_000, output: 0 }),
      row({ model: "claude-old-1", input: 10, output: 5 }),
    ]);
    expect(summary).toEqual({
      requests: 3,
      tokens: 1_100_000 + 500_000 + 15,
      cost: 4.5 + 1.5,
      unpriced: [{ model: "claude-old-1", requests: 1, tokens: 15 }],
    });
    expect(summarizeUsage([])).toEqual({ requests: 0, tokens: 0, cost: 0, unpriced: [] });
  });

  it("chooses the model: the saved choice, else Sonnet; an env override only if listed", () => {
    expect(modelFor("minutes", undefined)).toBe("claude-sonnet-4-5");
    expect(modelFor("minutes", { minutes: "claude-haiku-4-5" })).toBe("claude-haiku-4-5");
    expect(modelFor("minutes", { minutes: "claude-haiku-4-5" }, "claude-sonnet-4-5")).toBe(
      "claude-sonnet-4-5",
    );
    expect(modelFor("minutes", { minutes: "claude-haiku-4-5" }, "gpt-5")).toBe("claude-haiku-4-5");
    expect(modelFor("proofCheck", { minutes: "claude-haiku-4-5" })).toBe("claude-sonnet-4-5");
    expect(modelFor("minutes", { minutes: "not-listed" })).toBe("claude-sonnet-4-5");
  });

  it("accepts only listed models for every feature", () => {
    const models = Object.fromEntries(AI_FEATURES.map((f) => [f, "claude-haiku-4-5"]));
    expect(AiSettingsInputSchema.safeParse({ models, version: null }).success).toBe(true);
    const bad = { models: { ...models, minutes: "gpt-5" }, version: null };
    expect(AiSettingsInputSchema.safeParse(bad).success).toBe(false);
    expect(AiSettingsInputSchema.safeParse({ models, version: null, extra: 1 }).success).toBe(
      false,
    );
  });
});
