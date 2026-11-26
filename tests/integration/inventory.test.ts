import { beforeEach, describe, expect, it } from "vitest";
import { createSqlInventoryReader, createSqlInventoryStore } from "@website/db/sql";
import { scopeOfItem } from "@website/domain/inventory";
import { can, normalizePermissions, type Principal } from "@website/permissions";
import { createInventoryActions } from "../../apps/admin/src/server/inventory";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlInventoryStore>[0];
const now = new Date("2026-11-27T05:00:00Z");
const staff = (
  permissions: string[],
  scope: Principal["assignments"][number]["scope"],
): Principal => ({
  kind: "user",
  userId: "keeper-1",
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const global = staff(["inventory.read", "inventory.edit"], { type: "global" });
const context = () =>
  Promise.resolve({ actorEmail: "keeper@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeDb>;
const db = () => fake.db as unknown as Db;
const actions = () =>
  createInventoryActions({
    inventory: createSqlInventoryStore(db()),
    unitPath: (id) => Promise.resolve(id === "u2" ? ["u1", "u2"] : null),
    chapterExists: (id) => Promise.resolve(id === "c1"),
    now: () => now,
  });
const fields = (over: Record<string, unknown> = {}) => ({
  name: "Banner",
  category: "Print",
  description: "",
  image: null,
  condition: "good",
  location: "Store",
  custodianUserId: null,
  custodianName: "",
  published: true,
  ...over,
});
const newItem = (over: Record<string, unknown> = {}) => ({
  ...fields(over),
  owner: { kind: "region" },
  total: 5,
  ...over,
});
const logRows = () =>
  [...fake.docs.entries()].filter(([key]) => key.startsWith("inventoryLog/")).map(([, v]) => v);

beforeEach(() => {
  fake = fakeDb();
});

describe("inventory items (N7.1)", () => {
  it("a new item starts full and writes one log row", async () => {
    const result = await actions().create(...as(global))(newItem());
    if (!result.ok) throw new Error("create failed");
    expect(fake.docs.get(`inventoryItems/${result.data.id}`)).toMatchObject({
      total: 5,
      available: 5,
    });
    expect(logRows()).toMatchObject([{ action: "added", change: 5, by: "keeper-1" }]);
  });

  it("every change of stock or condition is one transaction with its log row", async () => {
    const a = actions();
    const created = await a.create(...as(global))(newItem());
    if (!created.ok) throw new Error("create failed");
    const total = await a.setTotal(...as(global))({
      id: created.data.id,
      version: created.data.version,
      total: 8,
      note: "bought three",
    });
    if (!total.ok) throw new Error("total failed");
    await a.update(...as(global))({
      ...fields({ condition: "damaged" }),
      id: created.data.id,
      version: total.data.version,
    });
    expect(logRows().map((r) => (r as { action: string }).action)).toEqual([
      "added",
      "adjusted",
      "damaged",
    ]);
    expect(fake.docs.get(`inventoryItems/${created.data.id}`)).toMatchObject({
      total: 8,
      available: 8,
      condition: "damaged",
    });
  });

  it("a refused change writes no log row and keeps the stock", async () => {
    const a = actions();
    const created = await a.create(...as(global))(newItem());
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;
    fake.docs.set(`inventoryItems/${id}`, {
      ...fake.docs.get(`inventoryItems/${id}`)!,
      available: 1,
    });
    const result = await a.setTotal(...as(global))({
      id,
      version: created.data.version,
      total: 2,
      note: "",
    });
    expect(result).toMatchObject({ error: "refused" });
    expect(logRows()).toHaveLength(1);
    expect(fake.docs.get(`inventoryItems/${id}`)).toMatchObject({ total: 5, available: 1 });
  });

  it("an item with loans out cannot be deleted", async () => {
    const a = actions();
    const created = await a.create(...as(global))(newItem());
    if (!created.ok) throw new Error("create failed");
    const id = created.data.id;
    fake.docs.set(`inventoryItems/${id}`, {
      ...fake.docs.get(`inventoryItems/${id}`)!,
      available: 4,
    });
    expect(await a.remove(...as(global))({ id, version: 1 })).toMatchObject({ error: "refused" });
    fake.docs.set(`inventoryItems/${id}`, {
      ...fake.docs.get(`inventoryItems/${id}`)!,
      available: 5,
    });
    expect(await a.remove(...as(global))({ id, version: 1 })).toMatchObject({ ok: true });
  });

  it("is managed only by the owner's scope", async () => {
    const chapterKeeper = staff(["inventory.edit"], { type: "chapter", chapterId: "c1" });
    const unitKeeper = staff(["inventory.edit"], { type: "orgUnit", orgUnitId: "u2" });
    const a = actions();
    // a chapter keeper creates for their chapter, never for the region or another chapter
    expect(
      await a.create(...as(chapterKeeper))(
        newItem({ owner: { kind: "chapter", chapterId: "c1" } }),
      ),
    ).toMatchObject({ ok: true });
    expect(await a.create(...as(chapterKeeper))(newItem())).toMatchObject({ error: "forbidden" });
    expect(
      await a.create(...as(chapterKeeper))(
        newItem({ owner: { kind: "chapter", chapterId: "c9" } }),
      ),
    ).toMatchObject({ error: "forbidden" });
    // the unit path is read on the server
    const unit = await a.create(...as(global))(
      newItem({ owner: { kind: "unit", orgUnitId: "u2" } }),
    );
    if (!unit.ok) throw new Error("create failed");
    expect(fake.docs.get(`inventoryItems/${unit.data.id}`)).toMatchObject({
      owner: { kind: "unit", orgUnitId: "u2", orgUnitPath: ["u1", "u2"] },
    });
    // a keeper of the unit manages the unit's items, not the region's
    expect(can(unitKeeper, "inventory.edit", scopeOfItem({ kind: "region" }))).toBe(false);
    expect(
      await a.update(...as(unitKeeper))({
        ...fields({ name: "Tent" }),
        id: unit.data.id,
        version: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await a.update(...as(chapterKeeper))({ ...fields(), id: unit.data.id, version: 1 }),
    ).toMatchObject({ error: "forbidden" });
  });

  it("the public catalogue lists published, not retired items, with the number available", async () => {
    const a = actions();
    await a.create(...as(global))(newItem({ name: "Speaker" }));
    await a.create(...as(global))(newItem({ name: "Costume", published: false }));
    await a.create(...as(global))(newItem({ name: "Old tent", condition: "retired" }));
    const items = await createSqlInventoryReader(db()).catalogue();
    expect(items.map((i) => [i.name, i.available])).toEqual([["Speaker", 5]]);
  });
});
