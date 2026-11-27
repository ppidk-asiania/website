import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlOpportunityApplicationStore,
  createSqlOpportunityApplicationWebStore,
  createSqlOpportunityStore,
} from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createOpportunityApplicationActions } from "../../apps/admin/src/server/opportunity-applications";
import { createOpportunityActions } from "../../apps/admin/src/server/opportunities";
import { createOpportunityApplications } from "../../apps/web/src/server/opportunity-applications";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlOpportunityStore>[0];
const now = new Date("2026-11-27T05:00:00Z");
const PDF = new TextEncoder().encode("%PDF-1.4 cv");
const staff = (scope: Principal["assignments"][number]["scope"]): Principal => ({
  kind: "user",
  userId: "editor-1",
  active: true,
  assignments: [
    { roleId: "r", scope, permissions: new Set(normalizePermissions(["opportunities.edit"])) },
  ],
});
const global = staff({ type: "global" });
const chapter1 = staff({ type: "chapter", chapterId: "ch-1" });
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;

let fake: ReturnType<typeof fakeDb>;
let stored: Map<string, Uint8Array>;
let told: Array<[string, string]>;
let sent: string[];
let profileOk: boolean;
let n: number;
const db = () => fake.db as unknown as Db;

const posts = () =>
  createOpportunityActions({
    opportunities: createSqlOpportunityStore(db()),
    chapterExists: () => Promise.resolve(true),
    isAccountForm: () => Promise.resolve(true),
    now: () => now,
  });
const reviewers = () =>
  createOpportunityApplicationActions({
    opportunities: createSqlOpportunityStore(db()),
    applications: createSqlOpportunityApplicationStore(db()),
    storage: {
      signedReadUrl: (path) => Promise.resolve(`https://files.example/${path}?sig=1`),
      remove: (path) => {
        stored.delete(path);
        return Promise.resolve();
      },
    },
    notify: {
      applicationStatus: (userId, application, _title, status) => {
        told.push([userId, `${application.id}:${status}`]);
        return Promise.resolve();
      },
    },
    now: () => now,
  });
const web = () =>
  createOpportunityApplications({
    applications: createSqlOpportunityApplicationWebStore(db()),
    storage: {
      save: (path, bytes) => {
        stored.set(path, bytes);
        return Promise.resolve({ url: null });
      },
      remove: (path) => {
        stored.delete(path);
        return Promise.resolve();
      },
    },
    send: (_message, key) => {
      sent.push(key);
      return Promise.resolve();
    },
    profileComplete: () => Promise.resolve(profileOk),
    now: () => now,
    uuid: () => `u${++n}`,
  });

const post = async (over: Record<string, unknown> = {}, who: Principal = global) => {
  const result = await posts().create(...as(who))({
    title: "Summer internship",
    organization: "Acme",
    country: "Japan",
    city: "",
    type: "internship",
    description: "",
    requirements: "",
    deadline: "2026-12-31",
    applyUrl: "",
    image: null,
    status: "open",
    chapterId: null,
    ...over,
  });
  if (!result.ok) throw new Error("create failed");
  return result.data.id;
};
const form = (letter: string | null, cv: Uint8Array | string | null = PDF) => {
  const data = new FormData();
  if (letter !== null) data.set("coverLetter", letter);
  if (cv !== null) data.set("cv", new File([cv], "cv.pdf", { type: "application/pdf" }));
  return new Request("https://web.example/api/opportunities/x/applications", {
    method: "POST",
    body: data,
  });
};
const LETTER = "I would love to work with your team this summer.";
const user = (uid = "u-1") => ({ uid, email: `${uid}@example.org` });
const applyAs = (id: string, u = user(), request = form(LETTER)) => web().apply(u, id, request);

beforeEach(() => {
  fake = fakeDb();
  stored = new Map();
  told = [];
  sent = [];
  profileOk = true;
  n = 0;
});

describe("applications on the platform (N6.2)", () => {
  it("takes one application per account, with the CV kept private and a receipt sent", async () => {
    const id = await post();
    expect((await applyAs(id)).status).toBe(201);
    expect([...stored.keys()]).toHaveLength(1);
    expect(sent).toEqual([`opportunity:${id}_u-1:received`]);
    expect(fake.docs.get(`opportunityApplications/${id}_u-1`)).toMatchObject({
      status: "submitted",
      userId: "u-1",
      note: null,
    });
  });

  it("a second try is refused and leaves the first CV alone", async () => {
    const id = await post();
    await applyAs(id);
    const first = [...stored.keys()];
    expect((await applyAs(id)).status).toBe(409);
    expect([...stored.keys()]).toEqual(first);
  });

  it("refuses a posting with an outside link, a closed one and one past its deadline", async () => {
    const outside = await post({ applyUrl: "https://acme.example/apply" });
    const closed = await post({ status: "closed" });
    const late = await post({ deadline: "2026-11-01" });
    for (const id of [outside, closed, late]) expect((await applyAs(id)).status).toBe(409);
    expect(stored.size).toBe(0);
  });

  it("needs sign-in, a complete profile, a real PDF and a cover letter", async () => {
    const id = await post();
    expect((await web().apply(null, id, form(LETTER))).status).toBe(401);
    expect((await applyAs(id, user(), form("short"))).status).toBe(400);
    expect((await applyAs(id, user(), form(LETTER, "not a pdf"))).status).toBe(400);
    expect((await applyAs(id, user(), form(LETTER, null))).status).toBe(400);
    profileOk = false;
    expect((await applyAs(id)).status).toBe(403);
    expect(stored.size).toBe(0);
  });

  it("an applicant who is not staff cannot review anything", async () => {
    const id = await post();
    await applyAs(id);
    const outsider = {
      ...global,
      assignments: [
        { roleId: "r", scope: { type: "global" }, permissions: new Set(normalizePermissions([])) },
      ],
    } as Principal;
    expect(
      await reviewers().review(...as(outsider))({ id: `${id}_u-1`, status: null, note: "x" }),
    ).toMatchObject({ error: "forbidden" });
  });

  it("staff move the status along the chain and the applicant is told once per change", async () => {
    const id = await post();
    await applyAs(id);
    const app = `${id}_u-1`;
    const review = (status: string | null, note = "") =>
      reviewers().review(...as(global))({ id: app, status, note });
    expect(await review("interview")).toMatchObject({ error: "refused" });
    expect(await review("under_review", "strong")).toMatchObject({ ok: true });
    expect(await review(null, "strong, call her")).toMatchObject({ ok: true });
    expect(await review("interview")).toMatchObject({ ok: true });
    expect(told).toEqual([
      ["u-1", `${app}:under_review`],
      ["u-1", `${app}:interview`],
    ]);
    expect(fake.docs.get(`opportunityApplications/${app}`)).toMatchObject({
      status: "interview",
      note: null,
    });
  });

  it("a chapter editor reviews only its own chapter's postings and opens only their CVs", async () => {
    const mine = await post({ chapterId: "ch-1" }, chapter1);
    const regional = await post();
    await applyAs(mine);
    await applyAs(regional);
    const review = (id: string) =>
      reviewers().review(...as(chapter1))({ id: `${id}_u-1`, status: "under_review", note: "" });
    expect(await review(mine)).toMatchObject({ ok: true });
    expect(await review(regional)).toMatchObject({ error: "forbidden" });
    const open = (id: string, who: Principal | null) => reviewers().openCv(`${id}_u-1`, who);
    expect((await open(mine, chapter1)).status).toBe(302);
    expect((await open(regional, chapter1)).status).toBe(403);
    expect((await open(mine, null)).status).toBe(401);
    expect((await open("nope", chapter1)).status).toBe(404);
    const link = (await open(mine, chapter1)).headers.get("location") ?? "";
    expect(link).toContain("opportunities/cv/");
  });

  it("deleting one application removes the row and the CV file, and is audited", async () => {
    const id = await post();
    await applyAs(id);
    expect(await reviewers().remove(...as(global))({ id: `${id}_u-1` })).toMatchObject({
      ok: true,
    });
    expect(fake.docs.has(`opportunityApplications/${id}_u-1`)).toBe(false);
    expect(stored.size).toBe(0);
    expect(
      [...fake.docs.entries()].some(
        ([key, doc]) =>
          key.startsWith("auditLogs/") && JSON.stringify(doc).includes("opportunityApplication"),
      ),
    ).toBe(true);
  });

  it("an applicant reads only their own applications, without the note", async () => {
    const id = await post();
    await applyAs(id, user("u-1"));
    await applyAs(id, user("u-2"));
    await reviewers().review(...as(global))({ id: `${id}_u-1`, status: null, note: "private" });
    const mine = await createSqlOpportunityApplicationWebStore(db()).mine("u-1");
    expect(mine.map((a) => a.userId)).toEqual(["u-1"]);
    expect(await createSqlOpportunityApplicationWebStore(db()).mine("nobody")).toEqual([]);
  });
});
