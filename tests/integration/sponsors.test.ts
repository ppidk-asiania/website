import { beforeEach, describe, expect, it } from "vitest";
import { createSqlSponsorReader, createSqlSponsorStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createSponsorActions } from "../../apps/admin/src/server/sponsors";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlSponsorStore>[0];
const now = new Date("2026-11-26T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "editor-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const editor = staff(["sponsors.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const row = (over: Record<string, unknown> = {}) => ({
  name: "Acme",
  tier: "gold",
  logo: null,
  link: "https://acme.example",
  order: 0,
  published: true,
  version: null,
  ...over,
});

let fake: ReturnType<typeof fakeDb>;
const db = () => fake.db as unknown as Db;
const actions = () =>
  createSponsorActions({ sponsors: createSqlSponsorStore(db()), now: () => now });
const directory = () => createSqlSponsorReader(db()).directory();
const activate = (id: string) => {
  fake.docs.set("settings/activePeriod", { periodId: id });
  fake.docs.set(`periods/${id}`, { startsOn: "2026-01-01", endsOn: "2026-12-31" });
};

beforeEach(() => {
  fake = fakeDb();
});

describe("sponsors directory (N5.3)", () => {
  it("needs an active period before a sponsor can be added", async () => {
    expect(await actions().save(...as(editor))(row())).toMatchObject({ error: "refused" });
  });

  it("needs sponsors.edit", async () => {
    activate("p1");
    expect(await actions().save(...as(staff(["sponsors.read"])))(row())).toMatchObject({
      error: "forbidden",
    });
  });

  it("shows published sponsors of the active period by tier; drafts and deleted ones stay hidden", async () => {
    activate("p1");
    const a = actions();
    await a.save(...as(editor))(row({ name: "Gold Co" }));
    await a.save(...as(editor))(row({ name: "Top Co", tier: "platinum" }));
    await a.save(...as(editor))(row({ name: "Draft Co", published: false }));
    const gone = await a.save(...as(editor))(row({ name: "Gone Co" }));
    if (!gone.ok) throw new Error("save failed");
    await a.remove(...as(editor))({ id: gone.data.id, version: gone.data.version });
    const { sponsors, period } = await directory();
    expect(sponsors.map((s) => s.name)).toEqual(["Top Co", "Gold Co"]);
    expect(period).toEqual({ startsOn: "2026-01-01", endsOn: "2026-12-31" });
  });

  it("an old period's sponsors leave the page when a new period is activated", async () => {
    activate("p1");
    await actions().save(...as(editor))(row());
    activate("p2");
    expect((await directory()).sponsors).toEqual([]);
  });

  it("editing keeps the sponsor's own period", async () => {
    activate("p1");
    const created = await actions().save(...as(editor))(row());
    if (!created.ok) throw new Error("save failed");
    activate("p2");
    await actions().save(...as(editor))(
      row({ id: created.data.id, version: created.data.version, name: "Acme Ltd" }),
    );
    expect(fake.docs.get(`sponsors/${created.data.id}`)).toMatchObject({
      periodId: "p1",
      name: "Acme Ltd",
    });
  });

  it("no period: the directory is empty", async () => {
    expect(await directory()).toEqual({ sponsors: [], period: null });
  });
});
