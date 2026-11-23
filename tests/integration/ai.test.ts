import { beforeEach, describe, expect, it } from "vitest";
import { createSqlAiStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { aiCard, createAiActions } from "../../apps/admin/src/server/ai";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlAiStore>[0];
const now = new Date("2026-11-16T09:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "boss",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const context = () =>
  Promise.resolve({ actorEmail: "boss@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeDb>;
const store = () => createSqlAiStore(fake.db as unknown as Db);
const actions = () => createAiActions({ ai: store() });
const models = (minutes: string) => ({
  minutes,
  proofCheck: "claude-sonnet-4-5",
  applicationAnalysis: "claude-sonnet-4-5",
});

beforeEach(() => {
  fake = fakeDb();
});

describe("AI settings and dashboard card (step 10.5)", () => {
  it("saves the model per feature with a version, audited; unlisted models and strangers are refused", async () => {
    const boss = staff(["ai.edit"]);
    const first = await actions().saveSettings(...as(boss))({
      version: null,
      models: models("claude-haiku-4-5"),
    });
    expect(first).toMatchObject({ ok: true });
    expect((await store().readSettings()).settings.models).toMatchObject({
      minutes: "claude-haiku-4-5",
    });
    expect(fake.writes.some((w) => w.path.startsWith("auditLogs/"))).toBe(true);

    const stale = await actions().saveSettings(...as(boss))({
      version: null,
      models: models("claude-sonnet-4-5"),
    });
    expect(stale).toMatchObject({ ok: false });
    const bad = await actions().saveSettings(...as(boss))({ version: 1, models: models("gpt-5") });
    expect(bad).toMatchObject({ ok: false });
    const denied = await actions().saveSettings(...as(staff(["ai.read"])))({
      version: 1,
      models: models("claude-sonnet-4-5"),
    });
    expect(denied).toMatchObject({ ok: false });
    expect((await store().readSettings()).settings.models.minutes).toBe("claude-haiku-4-5");
  });

  it("the card shows the key tail, the models and this and last month; unpriced usage apart", async () => {
    const use = (at: string, model: string, input: number) =>
      store().recordUsage({
        feature: "minutes",
        model,
        uid: "u1",
        at: new Date(at),
        input,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
      });
    await use("2026-11-02T00:00:00Z", "claude-sonnet-4-5", 1_000_000);
    await use("2026-11-15T00:00:00Z", "claude-haiku-4-5", 1_000_000);
    await use("2026-10-31T23:00:00Z", "claude-sonnet-4-5", 2_000_000);
    await use("2026-10-05T00:00:00Z", "claude-old-1", 100);
    await use("2026-09-30T23:00:00Z", "claude-sonnet-4-5", 9_000_000);

    const card = await aiCard({
      ai: store(),
      env: { ANTHROPIC_API_KEY: "sk-ant-abcdef1234" },
      now,
    });
    expect(card.keyTail).toBe("1234");
    expect(JSON.stringify(card)).not.toContain("sk-ant");
    expect(card.models.minutes).toBe("claude-sonnet-4-5");
    expect(card.thisMonth).toMatchObject({ requests: 2, tokens: 2_000_000, cost: 4 });
    expect(card.lastMonth).toMatchObject({
      requests: 2,
      tokens: 2_000_100,
      cost: 6,
      unpriced: [{ model: "claude-old-1", requests: 1, tokens: 100 }],
    });
    expect((await aiCard({ ai: store(), env: {}, now })).keyTail).toBeNull();
  });
});
