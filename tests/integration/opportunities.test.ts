import { beforeEach, describe, expect, it } from "vitest";
import { createSqlOpportunityReader, createSqlOpportunityStore } from "@website/db/sql";
import { boardOf } from "@website/domain/opportunities";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createOpportunityActions } from "../../apps/admin/src/server/opportunities";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlOpportunityStore>[0];
const now = new Date("2026-11-26T05:00:00Z");
const staff = (permissions: string[], scope: Principal["assignments"][number]["scope"]) =>
  ({
    kind: "user",
    userId: "editor-1",
    active: true,
    assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
  }) as Principal;
const global = staff(["opportunities.edit"], { type: "global" });
const chapterEditor = staff(["opportunities.edit"], { type: "chapter", chapterId: "ch-1" });
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const post = (over: Record<string, unknown> = {}) => ({
  title: "Summer internship",
  organization: "Acme",
  country: "Japan",
  city: "Tokyo",
  type: "internship",
  description: "<p>Hello</p><script>alert(1)</script>",
  requirements: "",
  deadline: "2026-12-31",
  applyUrl: "https://acme.example/apply",
  image: null,
  status: "open",
  chapterId: null,
  ...over,
});

let fake: ReturnType<typeof fakeDb>;
const db = () => fake.db as unknown as Db;
const actions = () =>
  createOpportunityActions({
    opportunities: createSqlOpportunityStore(db()),
    chapterExists: (id) => Promise.resolve(id === "ch-1" || id === "ch-2"),
    now: () => now,
  });
const created = async (principal: Principal, over: Record<string, unknown> = {}) => {
  const result = await actions().create(...as(principal))(post(over));
  if (!result.ok) throw new Error(`create failed: ${result.error}`);
  return result.data;
};

beforeEach(() => {
  fake = fakeDb();
});

describe("opportunities board (N6.1)", () => {
  it("needs opportunities.edit and keeps the poster", async () => {
    const readOnly = staff(["opportunities.read"], { type: "global" });
    expect(await actions().create(...as(readOnly))(post())).toMatchObject({ error: "forbidden" });
    const { id } = await created(global);
    expect(fake.docs.get(`opportunities/${id}`)).toMatchObject({ postedBy: "editor-1" });
  });

  it("stores the description as safe HTML", async () => {
    const { id } = await created(global);
    expect(fake.docs.get(`opportunities/${id}`)?.["description"]).toBe("<p>Hello</p>");
  });

  it("a chapter editor manages only its own chapter's postings", async () => {
    expect(await actions().create(...as(chapterEditor))(post())).toMatchObject({
      error: "forbidden",
    });
    expect(await actions().create(...as(chapterEditor))(post({ chapterId: "ch-2" }))).toMatchObject(
      { error: "forbidden" },
    );
    const mine = await created(chapterEditor, { chapterId: "ch-1" });
    const regional = await created(global);
    const { chapterId: _drop, ...fields } = post();
    void _drop;
    const edit = (data: { id: string; version: number }) =>
      actions().update(...as(chapterEditor))({ ...fields, ...data });
    expect(await edit(mine)).toMatchObject({ ok: true });
    expect(await edit(regional)).toMatchObject({ error: "forbidden" });
    expect(
      await actions().remove(...as(chapterEditor))({ id: regional.id, version: regional.version }),
    ).toMatchObject({ error: "forbidden" });
  });

  it("refuses a chapter that does not exist", async () => {
    expect(await actions().create(...as(global))(post({ chapterId: "nope" }))).toMatchObject({
      error: "refused",
    });
  });

  it("closing moves a posting to the archive; deleting removes it from both lists", async () => {
    const open = await created(global);
    const old = await created(global, { title: "Old call" });
    await actions().setStatus(...as(global))({ ...old, status: "closed" });
    const gone = await created(global, { title: "Gone call" });
    await actions().remove(...as(global))(gone);
    const all = await createSqlOpportunityReader(db()).all();
    expect(boardOf(all, "2026-11-26", "board").map((o) => o.id)).toEqual([open.id]);
    expect(boardOf(all, "2026-11-26", "archive").map((o) => o.id)).toEqual([old.id]);
  });

  it("counts clicks without storing who clicked", async () => {
    const { id } = await created(global);
    const reader = createSqlOpportunityReader(db());
    await reader.countClick(id);
    await reader.countClick(id);
    expect(fake.docs.get(`opportunityClicks/${id}`)).toEqual({ count: 2 });
    expect((await createSqlOpportunityStore(db()).clickCounts([id])).get(id)).toBe(2);
  });
});
