import { beforeEach, describe, expect, it } from "vitest";
import { createSqlOrgDocumentReader, createSqlOrgDocumentStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createOrgDocumentActions } from "../../apps/admin/src/server/org-documents";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlOrgDocumentStore>[0];
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
const editor = staff(["organizations.edit"]);
const reader = staff(["organizations.read"]);
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const row = (over: Record<string, unknown> = {}) => ({
  type: "statutes",
  title: "AD/ART",
  versionLabel: "2026",
  date: "2026-01-02",
  file: { path: "documents/0b6f1c2e-aaaa.pdf", name: "ad-art.pdf", size: 8 },
  link: "",
  published: true,
  version: null,
  ...over,
});

let fake: ReturnType<typeof fakeDb>;
let saved: Array<{ path: string; visibility: string }>;
const actions = () =>
  createOrgDocumentActions({
    documents: createSqlOrgDocumentStore(fake.db as unknown as Db),
    storage: {
      save: (path, _bytes, options) => {
        saved.push({ path, visibility: options.visibility });
        return Promise.resolve();
      },
    },
    now: () => now,
    uuid: () => "11111111-2222",
  });
const published = () => createSqlOrgDocumentReader(fake.db as unknown as Db).listPublished();
const upload = (body: Uint8Array) =>
  new Request("https://admin.test/api/org-documents", {
    method: "POST",
    body: body as unknown as ArrayBuffer,
  });

beforeEach(() => {
  fake = fakeDb();
  saved = [];
});

describe("Organisation documents", () => {
  it("an unpublished document is hidden and an old version stays listed", async () => {
    const a = actions();
    await a.save(...as(editor))(row({ versionLabel: "2024", date: "2024-01-01" }));
    await a.save(...as(editor))(row({ versionLabel: "2026" }));
    await a.save(...as(editor))(row({ title: "Draft rules", published: false }));
    const list = await published();
    expect(list.map((d) => d.versionLabel).sort()).toEqual(["2024", "2026"]);
    expect(list.every((d) => d.href.startsWith("/files/documents/"))).toBe(true);
  });

  it("a deleted document leaves the public list", async () => {
    const a = actions();
    const created = await a.save(...as(editor))(row());
    if (!created.ok) throw new Error("save failed");
    await a.remove(...as(editor))({ id: created.data.id, version: created.data.version });
    expect(await published()).toEqual([]);
  });

  it("needs organizations.edit to save", async () => {
    expect(await actions().save(...as(reader))(row())).toMatchObject({ error: "forbidden" });
  });

  it("stores an uploaded PDF as a public file under documents/", async () => {
    const response = await actions().uploadFile(...as(editor))(upload(pdf));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ path: "documents/11111111-2222.pdf", size: 8 });
    expect(saved).toEqual([{ path: "documents/11111111-2222.pdf", visibility: "public" }]);
  });

  it("refuses a non-PDF, an oversize body and a caller without the right", async () => {
    const a = actions();
    expect((await a.uploadFile(...as(editor))(upload(new Uint8Array([1, 2, 3])))).status).toBe(400);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(pdf);
    expect((await a.uploadFile(...as(editor))(upload(big))).status).toBe(400);
    expect((await a.uploadFile(...as(reader))(upload(pdf))).status).toBe(403);
    expect(saved).toEqual([]);
  });
});
