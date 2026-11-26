import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlContributionWebStore,
  createSqlFlowStore,
  createSqlInventoryStore,
  createSqlLoanWebStore,
} from "@website/db/sql";
import { financePrefill, isOutsideOverdue } from "@website/domain/inventory";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createInventoryActions } from "../../apps/admin/src/server/inventory";
import { createInventoryFlowActions } from "../../apps/admin/src/server/inventory-flows";
import { createContributionOffers } from "../../apps/web/src/server/contribution-offers";
import { createLoanRequests } from "../../apps/web/src/server/loan-requests";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlFlowStore>[0];
const now = new Date("2026-11-27T05:00:00Z");

const principal = (
  userId: string,
  permissions: string[],
  scope: Principal["assignments"][number]["scope"] = { type: "global" },
): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const ALL = ["inventory.read", "inventory.edit", "inventory.approve"];
const keeper = principal("keeper", ALL);
const second = principal("second", ALL);
const context = () =>
  Promise.resolve({ actorEmail: "k@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;

let fake: ReturnType<typeof fakeDb>;
let n = 0;
let roles: Record<string, "board" | "member">;
const db = () => fake.db as unknown as Db;

const flows = () =>
  createInventoryFlowActions({
    flows: createSqlFlowStore(db()),
    inventory: createSqlInventoryStore(db()),
    unitPath: () => Promise.resolve(null),
    chapterExists: (id) => Promise.resolve(id === "c1"),
    committeeRole: (userId) => Promise.resolve(roles[userId] ?? null),
    now: () => now,
  });
const loans = () =>
  createLoanRequests({
    loans: createSqlLoanWebStore(db()),
    storage: { save: () => Promise.resolve(), remove: () => Promise.resolve() },
    send: () => Promise.resolve(),
    captcha: () => Promise.resolve(true),
    profileComplete: () => Promise.resolve(true),
    now: () => now,
    uuid: () => `loan${++n}`,
  });
const ask = (quantity: number, from: string, to: string, uid = "m1") =>
  loans().member(
    { uid, email: null },
    new Request("https://web.example/api/inventory/loans", {
      method: "POST",
      body: JSON.stringify({
        itemId: "item1",
        quantity,
        purpose: "Seminar",
        place: "Hall",
        from,
        to,
      }),
    }),
  );
const reserve = (over: Record<string, unknown> = {}, who = keeper) =>
  flows().reserve(...as(who))({
    itemId: "item1",
    eventId: "e1",
    quantity: 2,
    from: "2026-12-01",
    to: "2026-12-03",
    ...over,
  });
const offer = (
  over: Record<string, unknown> = {},
  user: { uid: string; email: string | null } = { uid: "m1", email: "m1@x.org" },
) =>
  createContributionOffers({
    offers: createSqlContributionWebStore(db()),
    profileComplete: () => Promise.resolve(true),
    now: () => now,
    uuid: () => "offer1",
  })(
    user,
    new Request("https://web.example/api/inventory/offers", {
      method: "POST",
      body: JSON.stringify({
        name: "Tent",
        description: "",
        quantity: 2,
        mode: "give",
        returnOn: null,
        ...over,
      }),
    }),
  );
const items = () => [...fake.docs.keys()].filter((k) => k.startsWith("inventoryItems/"));
const logActions = () =>
  [...fake.docs.entries()]
    .filter(([k]) => k.startsWith("inventoryLog/"))
    .map(([, v]) => (v as { action: string }).action);

beforeEach(async () => {
  fake = fakeDb();
  n = 0;
  roles = { boss: "board", helper: "member" };
  fake.docs.set("events/e1", { title: "Seminar", deletedAt: null });
  const created = await createInventoryActions({
    inventory: createSqlInventoryStore(db()),
    unitPath: () => Promise.resolve(null),
    chapterExists: () => Promise.resolve(true),
    now: () => now,
  }).create(...as(keeper))({
    name: "Speaker",
    category: "",
    description: "",
    image: null,
    condition: "good",
    location: "",
    custodianUserId: null,
    custodianName: "",
    published: true,
    owner: { kind: "region" },
    total: 3,
  });
  if (!created.ok) throw new Error("setup failed");
  fake.docs.set("inventoryItems/item1", fake.docs.get(`inventoryItems/${created.data.id}`)!);
  fake.docs.delete(`inventoryItems/${created.data.id}`);
});

describe("reservations (N7.3)", () => {
  it("a reservation blocks a loan only on its own dates, and releasing frees it", async () => {
    const reserved = await reserve();
    expect(reserved).toMatchObject({ ok: true });
    expect((await ask(2, "2026-12-02", "2026-12-04")).status).toBe(409);
    expect((await ask(2, "2026-12-05", "2026-12-06")).status).toBe(201);
    expect((await ask(1, "2026-12-02", "2026-12-03")).status).toBe(201);
    if (!reserved.ok) throw new Error("no reservation");
    expect(await flows().release(...as(keeper))({ id: reserved.data.id })).toMatchObject({
      ok: true,
    });
    expect((await ask(2, "2026-12-02", "2026-12-04", "m2")).status).toBe(201);
  });

  it("another event cannot take what is blocked, and a deleted event cannot reserve", async () => {
    await reserve();
    expect(await reserve({ quantity: 2, to: "2026-12-01" })).toMatchObject({ error: "refused" });
    expect(await reserve({ quantity: 1, from: "2026-12-04", to: "2026-12-04" })).toMatchObject({
      ok: true,
    });
    fake.docs.set("events/e1", { title: "Seminar", deletedAt: now });
    expect(await reserve({ from: "2027-01-01", to: "2027-01-01" })).toMatchObject({
      error: "refused",
    });
  });

  it("the event board may reserve; a plain committee member or a wrong scope may not", async () => {
    const asBoard = principal("boss", ["events.read"]);
    expect(await reserve({}, asBoard)).toMatchObject({ ok: true });
    expect(
      await reserve({ from: "2027-02-01", to: "2027-02-01" }, principal("helper", ["events.read"])),
    ).toMatchObject({
      error: "forbidden",
    });
    const chapterKeeper = principal("ck", ALL, { type: "chapter", chapterId: "c1" });
    expect(await reserve({ from: "2027-03-01", to: "2027-03-01" }, chapterKeeper)).toMatchObject({
      error: "forbidden",
    });
  });
});

describe("contributions (N7.3)", () => {
  it("an approved lent offer becomes exactly one item that keeps whose it is", async () => {
    expect((await offer({ mode: "lend", returnOn: "2026-12-31" })).status).toBe(201);
    const a = flows();
    expect(
      await a.approveContribution(...as(keeper))({ id: "offer1", owner: { kind: "region" } }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await a.approveContribution(...as(second))({ id: "offer1", owner: { kind: "region" } }),
    ).toMatchObject({
      error: "refused",
    });
    expect(items()).toHaveLength(2);
    const added = [...fake.docs.entries()].find(
      ([k, v]) => k.startsWith("inventoryItems/") && (v as { name: string }).name === "Tent",
    )![1] as { total: number; lentBy: { name: string; returnOn: string } };
    expect(added).toMatchObject({ total: 2, lentBy: { returnOn: "2026-12-31" } });
    expect(logActions().filter((x) => x === "added")).toHaveLength(2);
  });

  it("a lend needs a return date, a gift has none, and nobody decides on their own offer", async () => {
    expect((await offer({ mode: "lend", returnOn: null })).status).toBe(400);
    expect((await offer({ mode: "give", returnOn: "2026-12-31" })).status).toBe(400);
    expect((await offer({ mode: "lend", returnOn: "2026-01-01" })).status).toBe(400);
    await offer({}, { uid: "keeper", email: null });
    expect(
      await flows().approveContribution(...as(keeper))({ id: "offer1", owner: { kind: "region" } }),
    ).toMatchObject({ error: "refused" });
    expect(
      await flows().rejectContribution(...as(second))({ id: "offer1", note: "No room" }),
    ).toMatchObject({
      ok: true,
    });
    expect(items()).toHaveLength(1);
  });
});

describe("procurement (N7.3)", () => {
  const request = {
    owner: { kind: "region" },
    name: "Projector",
    category: "",
    why: "For the seminar",
    estimatedMinor: 450000000,
    currency: "IDR",
    urgency: "high",
  };

  it("is asked, decided by someone else, and fulfilled only after approval", async () => {
    const a = flows();
    const asked = await a.requestProcurement(...as(keeper))(request);
    if (!asked.ok) throw new Error("not asked");
    const id = asked.data.id;
    expect(
      await a.decideProcurement(...as(keeper))({ id, step: "approve", note: "" }),
    ).toMatchObject({
      error: "refused",
    });
    expect(
      await a.decideProcurement(...as(second))({ id, step: "fulfil", note: "" }),
    ).toMatchObject({
      error: "refused",
    });
    expect(
      await a.decideProcurement(...as(second))({ id, step: "reject", note: "" }),
    ).toMatchObject({
      error: "refused",
    });
    expect(
      await a.decideProcurement(...as(second))({ id, step: "approve", note: "" }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await a.decideProcurement(...as(second))({ id, step: "fulfil", note: "" }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await a.decideProcurement(...as(second))({ id, step: "approve", note: "" }),
    ).toMatchObject({
      error: "refused",
    });
  });

  it("an approved request starts a finance request with its own words and amount", () => {
    expect(
      financePrefill({
        name: "Projector",
        why: "For the seminar",
        estimatedMinor: 450000000,
        currency: "IDR",
      }),
    ).toEqual({
      title: "Purchase: Projector",
      description: "For the seminar",
      amountMinor: 450000000,
      currency: "IDR",
    });
  });
});

describe("loans to outside bodies (N7.3)", () => {
  const out = (over: Record<string, unknown> = {}) =>
    flows().lendOut(...as(keeper))({
      itemId: "item1",
      borrower: "Campus Club",
      contact: "club@x.org",
      purpose: "Open day",
      quantity: 1,
      conditionOut: "good",
      expectedBack: "2026-12-05",
      ...over,
    });

  it("takes stock out and puts it back, logging both; overdue is read-time", async () => {
    const lent = await out();
    if (!lent.ok) throw new Error("not lent");
    expect(fake.docs.get("inventoryItems/item1")).toMatchObject({ available: 2 });
    const stored = fake.docs.get(`outsideLoans/${lent.data.id}`) as {
      status: "out";
      expectedBack: string;
    };
    expect(isOutsideOverdue(stored, "2026-12-06")).toBe(true);
    expect(
      await flows().takeBackOutside(...as(keeper))({ id: lent.data.id, conditionIn: "good" }),
    ).toMatchObject({ ok: true });
    expect(fake.docs.get("inventoryItems/item1")).toMatchObject({ available: 3 });
    expect(logActions()).toEqual(expect.arrayContaining(["handed_over", "returned"]));
    expect(
      await flows().takeBackOutside(...as(keeper))({ id: lent.data.id, conditionIn: "" }),
    ).toMatchObject({ error: "refused" });
  });

  it("refuses more than is on the shelf, units reserved for an event, and a past date", async () => {
    expect(await out({ quantity: 4 })).toMatchObject({ error: "refused" });
    await reserve({ quantity: 2, from: "2026-11-27", to: "2026-12-05" });
    expect(await out({ quantity: 2 })).toMatchObject({ error: "refused" });
    expect(await out({ quantity: 1, expectedBack: "2026-11-01" })).toMatchObject({
      error: "refused",
    });
    expect(await out({ quantity: 1 })).toMatchObject({ ok: true });
    expect(fake.docs.get("inventoryItems/item1")).toMatchObject({ available: 2 });
  });
});
