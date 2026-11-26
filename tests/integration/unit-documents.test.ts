import { beforeEach, describe, expect, it } from "vitest";
import { createSqlUnitDocumentStore } from "@website/db/sql";
import type { ActiveSeat } from "@website/domain/organizations";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createUnitDocumentActions } from "../../apps/admin/src/server/unit-documents";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlUnitDocumentStore>[0];
let now = new Date("2026-11-26T05:00:00Z");
// A seat gives the officer role, which holds some page; that is what reaches the admin shell.
const person = (userId: string, permissions: string[] = ["tasks.read"]): Principal => ({
  kind: "user",
  userId,
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
  Promise.resolve({ actorEmail: "x@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;
const seat = (orgUnitId: string): ActiveSeat => ({
  orgUnitId,
  orgUnitPath: [orgUnitId],
  unitType: "divisi",
  seat: "member",
});
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const upload = (query: string, body: Uint8Array = PDF, name = "plan.pdf") =>
  new Request(`https://admin.test/api/unit-documents?${query}`, {
    method: "POST",
    headers: { "x-file-name": name },
    body: body as unknown as ArrayBuffer,
  });

const alice = person("alice");
const bob = person("bob");
const outsider = person("outsider");
const editor = person("editor", ["documents.edit"]);
const seatsOf: Record<string, ActiveSeat[]> = {
  alice: [seat("unit-1")],
  bob: [seat("unit-2")],
  outsider: [],
  editor: [],
};

let fake: ReturnType<typeof fakeDb>;
let files: Map<string, string>;
let cap = 1024 * 1024;
let counter = 0;
const store = () => createSqlUnitDocumentStore(fake.db as unknown as Db);
const actions = () =>
  createUnitDocumentActions({
    documents: store(),
    storage: {
      save: (path) => {
        files.set(path, "saved");
        return Promise.resolve();
      },
      remove: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
      signedReadUrl: (path) => Promise.resolve(`https://web.test/private-files?t=${path}`),
    },
    activePeriod: () => Promise.resolve({ id: "p1" }),
    seats: (uid) => Promise.resolve(seatsOf[uid] ?? []),
    unitPeriod: (id) => Promise.resolve(id === "unit-x" ? "p0" : "p1"),
    capBytes: () => Promise.resolve(cap),
    now: () => now,
    uuid: () => `00000000-${String(++counter).padStart(4, "0")}`,
  });
const add = (p: Principal, query: string, body?: Uint8Array, name?: string) =>
  actions().uploadFile(...as(p))(upload(query, body, name));
const listed = () => store().listForPeriod("p1");

beforeEach(() => {
  fake = fakeDb();
  files = new Map();
  cap = 1024 * 1024;
  counter = 0;
  now = new Date("2026-11-26T05:00:00Z");
});

describe("Unit documents", () => {
  it("a seat holder adds, renames and deletes in their own unit", async () => {
    const created = await add(alice, "unit=unit-1&title=Plan&folder=2026");
    expect(created.status).toBe(201);
    const { id, version } = (await created.json()) as { id: string; version: number };
    expect(await listed()).toMatchObject([{ orgUnitId: "unit-1", periodId: "p1", title: "Plan" }]);

    const renamed = await actions().update(...as(alice))({
      id,
      version,
      title: "Plan v2",
      folder: "",
    });
    expect(renamed).toMatchObject({ ok: true });
    const deleted = await actions().remove(...as(alice))({
      id,
      version: renamed.ok ? renamed.data.version : 0,
    });
    expect(deleted).toMatchObject({ ok: true });
    expect(await listed()).toEqual([]);
  });

  it("refuses a write into another unit, the period level and a unit of another period", async () => {
    expect((await add(alice, "unit=unit-2&title=Xx")).status).toBe(400);
    expect((await add(alice, "title=Xx")).status).toBe(400);
    expect((await add(editor, "unit=unit-x&title=Xx")).status).toBe(400);
    expect(files.size).toBe(0);
    expect((await add(editor, "title=Period level")).status).toBe(201);
  });

  it("a person with no seat and no extra is refused outright", async () => {
    expect((await add(outsider, "unit=unit-1&title=Xx")).status).toBe(403);
  });

  it("another unit's holder cannot rename or delete the file", async () => {
    const created = await add(alice, "unit=unit-1&title=Plan");
    const { id, version } = (await created.json()) as { id: string; version: number };
    expect(
      await actions().update(...as(bob))({ id, version, title: "Mine", folder: "" }),
    ).toMatchObject({
      error: "refused",
    });
    expect(await actions().remove(...as(bob))({ id, version })).toMatchObject({ error: "refused" });
    expect(await listed()).toHaveLength(1);
  });

  it("opening: any officer of the period reads; a person with no seat gets not found", async () => {
    const created = await add(alice, "unit=unit-1&title=Plan");
    const { id } = (await created.json()) as { id: string };
    const byBob = await actions().open(id, bob);
    expect(byBob.status).toBe(302);
    expect(byBob.headers.get("Location")).toContain("unit-documents/p1/");
    expect((await actions().open(id, outsider)).status).toBe(404);
    expect((await actions().open(id, null)).status).toBe(401);
  });

  it("a forged period is ignored: the file lands in the active period", async () => {
    const response = await add(alice, "unit=unit-1&title=Plan&period=p0&periodId=p0");
    expect(response.status).toBe(201);
    expect((await listed())[0]?.periodId).toBe("p1");
    expect(await store().listForPeriod("p0")).toEqual([]);
  });

  it("accepts only allowed files whose bytes match, and respects the unit cap", async () => {
    expect(
      (await add(alice, "unit=unit-1&title=Xx", new Uint8Array([1, 2, 3]), "plan.pdf")).status,
    ).toBe(400);
    expect((await add(alice, "unit=unit-1&title=Xx", PDF, "plan.exe")).status).toBe(400);
    cap = 10;
    expect((await add(alice, "unit=unit-1&title=Aa")).status).toBe(201);
    const over = await add(alice, "unit=unit-1&title=Bb");
    expect(over.status).toBe(400);
    const body = (await over.json()) as { message: string };
    expect(body.message).toContain("space");
  });

  it("purges a deleted file and its row 30 days after the delete, not before", async () => {
    const created = await add(alice, "unit=unit-1&title=Plan");
    const { id, version } = (await created.json()) as { id: string; version: number };
    await actions().remove(...as(alice))({ id, version });
    expect(await actions().purge()).toBe(0);
    now = new Date("2026-12-27T05:00:00Z");
    expect(await actions().purge()).toBe(1);
    expect(files.size).toBe(0);
    expect(await store().listTrashed()).toEqual([]);
  });
});
