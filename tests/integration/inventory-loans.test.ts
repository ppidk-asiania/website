import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSqlInventoryStore,
  createSqlLoanStore,
  createSqlLoanWebStore,
} from "@website/db/sql";
import type { Loan } from "@website/domain/inventory";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createDeadlineReminders } from "../../apps/admin/src/server/deadline-reminders";
import { createInventoryActions } from "../../apps/admin/src/server/inventory";
import { createLoanActions } from "../../apps/admin/src/server/loans";
import { createLoanRequests } from "../../apps/web/src/server/loan-requests";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlLoanStore>[0];
const now = new Date("2026-11-27T05:00:00Z");
const PDF = new TextEncoder().encode("%PDF-1.4 statement");

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
const keeper = principal("keeper", ["inventory.read", "inventory.edit", "inventory.approve"]);
const context = () =>
  Promise.resolve({ actorEmail: "keeper@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;

let fake: ReturnType<typeof fakeDb>;
let notices: Array<[string, string]>;
let profileOk: boolean;
let stored: Map<string, Uint8Array>;
let sent: string[];
const db = () => fake.db as unknown as Db;

const inventory = () =>
  createInventoryActions({
    inventory: createSqlInventoryStore(db()),
    unitPath: () => Promise.resolve(null),
    chapterExists: (id) => Promise.resolve(id === "c1"),
    now: () => now,
  });
const loanActions = () =>
  createLoanActions({
    loans: createSqlLoanStore(db()),
    inventory: createSqlInventoryStore(db()),
    storage: { signedReadUrl: (path) => Promise.resolve(`https://files.example/${path}?sig=1`) },
    notify: {
      loanStep: (loan: Loan, _name, step) => {
        notices.push([loan.id, step]);
        return Promise.resolve();
      },
    },
    now: () => now,
  });
let n = 0;
const web = () =>
  createLoanRequests({
    loans: createSqlLoanWebStore(db()),
    storage: {
      save: (path, bytes) => (stored.set(path, bytes), Promise.resolve()),
      remove: (path) => (stored.delete(path), Promise.resolve()),
    },
    send: (_message, key) => (sent.push(key), Promise.resolve()),
    captcha: (token) => Promise.resolve(token === "good"),
    profileComplete: () => Promise.resolve(profileOk),
    now: () => now,
    uuid: () => `loan${++n}`,
  });

const member = (uid = "m1") => ({ uid, email: `${uid}@x.org` });
const body = (over: Record<string, unknown> = {}) =>
  new Request("https://web.example/api/inventory/loans", {
    method: "POST",
    body: JSON.stringify({
      itemId: "item1",
      quantity: 1,
      purpose: "Seminar",
      place: "Hall",
      from: "2026-12-01",
      to: "2026-12-03",
      ...over,
    }),
  });
const outsiderRequest = (
  over: Record<string, string> = {},
  file: Uint8Array = PDF,
  token = "good",
) => {
  const q = new URLSearchParams({
    item: "item1",
    quantity: "1",
    purpose: "Wedding",
    place: "Hotel",
    from: "2026-12-01",
    to: "2026-12-03",
    name: "Budi",
    email: "budi@x.org",
    phone: "+62811111",
    ...over,
  });
  return new Request(`https://web.example/api/inventory/outsider?${q.toString()}`, {
    method: "POST",
    headers: { "x-captcha-token": token },
    body: file as unknown as ArrayBuffer,
  });
};
const item = (id = "item1") => fake.docs.get(`inventoryItems/${id}`) as Record<string, unknown>;
const logActions = () =>
  [...fake.docs.entries()]
    .filter(([k]) => k.startsWith("inventoryLog/"))
    .map(([, v]) => (v as { action: string }).action);

beforeEach(async () => {
  fake = fakeDb();
  notices = [];
  sent = [];
  stored = new Map();
  profileOk = true;
  n = 0;
  const created = await inventory().create(...as(keeper))({
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
    total: 1,
  });
  if (!created.ok) throw new Error("setup failed");
  fake.docs.set("inventoryItems/item1", fake.docs.get(`inventoryItems/${created.data.id}`)!);
  fake.docs.delete(`inventoryItems/${created.data.id}`);
});

describe("borrowing (N7.2)", () => {
  it("a member asks, an approver approves and hands over, stock and log follow, then it comes back", async () => {
    const asked = await web().member(member(), body());
    expect(asked.status).toBe(201);
    const a = loanActions();
    const id = "loan1";
    expect(await a.approve(...as(keeper))({ id })).toMatchObject({ ok: true });
    expect(await a.handOver(...as(keeper))({ id })).toMatchObject({ ok: true });
    expect(item()).toMatchObject({ total: 1, available: 0 });
    expect(await a.takeBack(...as(keeper))({ id, condition: "good", note: "" })).toMatchObject({
      ok: true,
    });
    expect(item()).toMatchObject({ total: 1, available: 1, condition: "good" });
    expect(logActions()).toEqual(expect.arrayContaining(["added", "handed_over", "returned"]));
    expect(notices.map(([, step]) => step)).toEqual(["approved", "handed_over", "returned"]);
  });

  it("two hand-overs for the last unit: one wins, the other is refused and changes nothing", async () => {
    await web().member(member("m1"), body());
    await web().member(member("m2"), body());
    const a = loanActions();
    await a.approve(...as(keeper))({ id: "loan1" });
    await a.approve(...as(keeper))({ id: "loan2" });
    expect(await a.handOver(...as(keeper))({ id: "loan1" })).toMatchObject({ ok: true });
    expect(await a.handOver(...as(keeper))({ id: "loan2" })).toMatchObject({ error: "refused" });
    expect(item()).toMatchObject({ available: 0 });
    expect(logActions().filter((x) => x === "handed_over")).toHaveLength(1);
  });

  it("a damaged return marks the item damaged", async () => {
    await web().member(member(), body());
    const a = loanActions();
    await a.approve(...as(keeper))({ id: "loan1" });
    await a.handOver(...as(keeper))({ id: "loan1" });
    await a.takeBack(...as(keeper))({ id: "loan1", condition: "damaged", note: "torn" });
    expect(item()).toMatchObject({ available: 1, condition: "damaged" });
    expect(logActions()).toContain("damaged");
  });

  it("the approver is never the borrower", async () => {
    await web().member(member("keeper"), body());
    expect(await loanActions().approve(...as(keeper))({ id: "loan1" })).toMatchObject({
      error: "refused",
    });
  });

  it("steps follow the states: no hand-over before approval, no second approval", async () => {
    await web().member(member(), body());
    const a = loanActions();
    expect(await a.handOver(...as(keeper))({ id: "loan1" })).toMatchObject({ error: "refused" });
    await a.approve(...as(keeper))({ id: "loan1" });
    expect(await a.approve(...as(keeper))({ id: "loan1" })).toMatchObject({ error: "refused" });
    expect(await a.reject(...as(keeper))({ id: "loan1", note: "not now" })).toMatchObject({
      error: "refused",
    });
  });

  it("only the owner's scope decides", async () => {
    fake.docs.set("inventoryItems/item1", {
      ...item(),
      owner: { kind: "chapter", chapterId: "c1" },
    });
    await web().member(member(), body());
    const other = principal("other", ["inventory.approve"], { type: "chapter", chapterId: "c2" });
    const own = principal("own", ["inventory.approve"], { type: "chapter", chapterId: "c1" });
    expect(await loanActions().approve(...as(other))({ id: "loan1" })).toMatchObject({
      error: "forbidden",
    });
    expect(await loanActions().approve(...as(own))({ id: "loan1" })).toMatchObject({ ok: true });
  });

  it("a request needs a complete profile, a future date, a listed item and a sane quantity", async () => {
    profileOk = false;
    expect((await web().member(member(), body())).status).toBe(403);
    profileOk = true;
    expect(
      (await web().member(member(), body({ from: "2026-11-20", to: "2026-11-21" }))).status,
    ).toBe(409);
    expect((await web().member(member(), body({ quantity: 5 }))).status).toBe(409);
    expect((await web().member(member(), body({ itemId: "nope" }))).status).toBe(409);
    expect((await web().member(null, body())).status).toBe(401);
    expect(fake.docs.has("itemLoans/loan1")).toBe(false);
  });

  it("a member cancels or asks to return only their own request", async () => {
    await web().member(member("m1"), body());
    expect((await web().step(member("m2"), "loan1", "cancel")).status).toBe(409);
    expect((await web().step(member("m1"), "loan1", "return")).status).toBe(409); // not out yet
    expect((await web().step(member("m1"), "loan1", "cancel")).status).toBe(200);
    expect(fake.docs.get("itemLoans/loan1")).toMatchObject({ status: "cancelled" });
  });

  it("an outsider needs the captcha and a real PDF; the statement stays private and the approver can open it", async () => {
    expect((await web().outsider(outsiderRequest({}, PDF, "bad"))).status).toBe(403);
    expect(
      (await web().outsider(outsiderRequest({}, new TextEncoder().encode("not a pdf")))).status,
    ).toBe(400);
    expect((await web().outsider(outsiderRequest({ email: "nope" }))).status).toBe(400);
    expect(stored.size).toBe(0);
    expect((await web().outsider(outsiderRequest())).status).toBe(201);
    expect(stored.has("inventory/statements/loan1.pdf")).toBe(true);
    expect(sent).toEqual(["loan:loan1:received"]);
    const response = await loanActions().openStatement("loan1", keeper);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("inventory/statements/loan1.pdf");
    expect(
      (await loanActions().openStatement("loan1", principal("x", ["inventory.read"]))).status,
    ).toBe(403);
  });

  it("the daily job reminds the borrower of an overdue loan once", async () => {
    await web().member(member(), body());
    await web().outsider(outsiderRequest());
    const a = loanActions();
    for (const id of ["loan1"]) {
      await a.approve(...as(keeper))({ id });
    }
    fake.docs.set("inventoryItems/item1", { ...item(), total: 2, available: 2 });
    await a.handOver(...as(keeper))({ id: "loan1" });
    await a.approve(...as(keeper))({ id: "loan2" });
    await a.handOver(...as(keeper))({ id: "loan2" });
    const keys: string[] = [];
    const store = createSqlLoanStore(db());
    const remind = createDeadlineReminders({
      applications: { bookingsBetween: () => Promise.resolve([]) },
      checkedIn: () => Promise.resolve([]),
      programs: () => Promise.resolve([]),
      lpj: () => Promise.resolve([]),
      overdueLoans: async (today) =>
        (await store.overdue(today)).map((l) => ({
          id: l.id,
          to: l.to,
          itemName: "Speaker",
          userId: l.borrower.kind === "member" ? l.borrower.userId : null,
          email: l.borrower.kind === "outsider" ? l.borrower.email : null,
        })),
      contacts: (uids) =>
        Promise.resolve(new Map(uids.map((u) => [u, { email: `${u}@x.org`, phone: null }]))),
      send: (_m, key) => {
        const status = keys.includes(key) ? "duplicate" : "sent";
        if (status === "sent") keys.push(key);
        return Promise.resolve(status as "sent");
      },
      adminUrl: "https://admin.example.org",
      now: () => new Date("2026-12-04T01:00:00Z"),
    });
    expect(await remind()).toEqual({ messages: 2 });
    expect(keys).toEqual(["reminder:loan:loan1:m1", "reminder:loan:loan2:email"]);
    expect(await remind()).toEqual({ messages: 0 });
    const early = createDeadlineReminders({
      applications: { bookingsBetween: () => Promise.resolve([]) },
      checkedIn: () => Promise.resolve([]),
      programs: () => Promise.resolve([]),
      lpj: () => Promise.resolve([]),
      overdueLoans: async (today) =>
        (await store.overdue(today)).map((l) => ({
          id: l.id,
          to: l.to,
          itemName: "",
          userId: null,
          email: null,
        })),
      contacts: () => Promise.resolve(new Map()),
      send: vi.fn(),
      adminUrl: "",
      now: () => new Date("2026-12-03T01:00:00Z"),
    });
    expect(await early()).toEqual({ messages: 0 }); // the return day itself is not late
  });
});
