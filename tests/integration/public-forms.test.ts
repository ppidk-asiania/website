import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlFormStore, createSqlFormWebStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createFormActions } from "../../apps/admin/src/server/forms";
import { createFormSubmission, createPublicFormReader } from "../../apps/web/src/server/forms";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlFormStore>[0];
let clock = new Date("2026-10-20T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "staff-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const owner = staff(["forms.edit", "forms.publish", "forms.export"]);
const context = () =>
  Promise.resolve({ actorEmail: "forms@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const question = (extra: Record<string, unknown> = {}) => ({
  id: "",
  type: "short_text",
  label: "Full name",
  description: "",
  required: true,
  options: [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});
const formInput = (extra: Record<string, unknown> = {}) => ({
  title: "Feedback Kongres 2026",
  description: "",
  usage: "public",
  opensAt: null,
  closesAt: null,
  questions: [
    question(),
    question({ type: "single_choice", label: "Rating", options: ["Good", "Bad"] }),
  ],
  ...extra,
});

let fake: ReturnType<typeof fakeDb>;
let store: ReturnType<typeof createSqlFormStore>;
let web: ReturnType<typeof createSqlFormWebStore>;
let tokens = 0;
const securityEvents: Array<{ actorId: string; details: Record<string, unknown> }> = [];
const actions = () =>
  createFormActions({
    forms: store,
    now: () => clock,
    uuid: () => crypto.randomUUID(),
    token: () => `token${String(++tokens).padStart(20, "0")}`,
    logExport: (actorId, details) => securityEvents.push({ actorId, details }),
  });
const captcha = vi.fn((token: string) => Promise.resolve(token === "human"));
type Signed = { uid: string; email: string | null; name: string | null };
const guestOf = { name: "Guest", email: "guest@example.org" };
const submit = (input: unknown, user: Signed | null = null) =>
  createFormSubmission({
    submit: (token, version, answers, now, who) => web.submit(token, version, answers, now, who),
    captcha,
    now: () => clock,
  })(user, { guest: guestOf, ...(input as object) });
const reader =
  (user: Signed | null = null) =>
  (token: string) =>
    createPublicFormReader({ find: (t, who) => web.findPublic(t, clock, who) })(token, user);
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const responses = () => [...fake.docs.keys()].filter((p) => p.startsWith("formResponses/"));

const published = async (extra: Record<string, unknown> = {}) => {
  const saved = await actions().save(...as(owner))({ ...formInput(extra), version: null });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  const result = await actions().publish(...as(owner))({ id: saved.data.id, version: 1 });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { id: saved.data.id, ...result.data };
};
const questionIds = async (formId: string, n = 1) =>
  ((await store.getVersion(formId, n))?.questions ?? []).map((q) => q.id);

beforeEach(() => {
  clock = new Date("2026-10-20T05:00:00Z");
  tokens = 0;
  securityEvents.length = 0;
  captcha.mockClear();
  fake = fakeDb();
  store = createSqlFormStore(fake.db as unknown as Db);
  web = createSqlFormWebStore(fake.db as unknown as Db);
});

describe("publishing a form (forms.publish)", () => {
  it("needs forms.publish; creates the random token once; audited", async () => {
    const saved = await actions().save(...as(owner))({ ...formInput(), version: null });
    const id = saved.ok ? saved.data.id : "";
    expect(await actions().publish(...as(staff(["forms.edit"])))({ id, version: 1 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await actions().publish(...as(owner))({ id, version: 1 })).toEqual({
      ok: true,
      data: { version: 2, publicToken: "token00000000000000000001" },
    });
    expect(auditEntries().at(-1)).toMatchObject({ action: "PUBLISH", revertible: false });
    expect(await actions().close(...as(owner))({ id, version: 2 })).toMatchObject({ ok: true });
    expect(await store.get(id)).toMatchObject({ status: "closed" });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UNPUBLISH", revertible: false });
    expect(await actions().publish(...as(owner))({ id, version: 3 })).toMatchObject({
      data: { publicToken: "token00000000000000000001" },
    });
    expect(await actions().close(...as(owner))({ id, version: 4 })).toMatchObject({ ok: true });
    expect(await actions().close(...as(owner))({ id, version: 5 })).toMatchObject({
      error: "refused",
      issues: ["Only a published form can be closed."],
    });
  });

  it("never publishes recruitment forms or forms with file questions", async () => {
    const recruitment = await actions().save(...as(owner))({
      ...formInput({ usage: "recruitment" }),
      version: null,
    });
    expect(
      await actions().publish(...as(owner))({
        id: recruitment.ok ? recruitment.data.id : "",
        version: 1,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("application")] });
    const withFile = await actions().save(...as(owner))({
      ...formInput({ questions: [question({ type: "file", label: "CV" })] }),
      version: null,
    });
    expect(
      await actions().publish(...as(owner))({
        id: withFile.ok ? withFile.data.id : "",
        version: 1,
      }),
    ).toMatchObject({ error: "refused", issues: ["Public forms cannot ask for files."] });
  });
});

describe("answering at /f/{token} (C2)", () => {
  it("shows the form without ids; unknown, draft and recruitment tokens are not found", async () => {
    const { publicToken, id } = await published();
    expect(await reader()(publicToken)).toMatchObject({
      state: "open",
      form: { title: "Feedback Kongres 2026", version: 1 },
    });
    expect(JSON.stringify(await reader()(publicToken))).not.toContain(id);
    expect(await reader()("tokenUnknown0000000000000")).toBeNull();
    expect(await reader()("../forms")).toBeNull();
    fake.docs.set(`forms/${id}`, { ...fake.docs.get(`forms/${id}`), usage: "recruitment" });
    expect(await reader()(publicToken)).toBeNull();
  });

  it("stores a valid response, freezes the version and counts it", async () => {
    const { id, publicToken } = await published();
    const [name, rating] = await questionIds(id);
    expect(
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: "Ari", [rating!]: "Good" },
        captcha: "human",
      }),
    ).toEqual({ ok: true });
    expect(responses()).toHaveLength(1);
    expect(fake.docs.get(responses()[0]!)).toMatchObject({
      formId: id,
      version: 1,
      answers: { [name!]: "Ari", [rating!]: "Good" },
    });
    expect(await store.getVersion(id, 1)).toMatchObject({ answered: true });
    expect(await store.get(id)).toMatchObject({ responseCount: 1, version: 2 });
    const edited = await actions().save(...as(owner))({
      ...formInput({ questions: [question({ id: name, label: "Name" })] }),
      id,
      version: 2,
    });
    expect(edited).toMatchObject({ ok: true, data: { currentVersion: 2, newVersion: true } });
    expect(await store.get(id)).toMatchObject({ responseCount: 1, status: "published" });
  });

  it("checks the captcha first and writes nothing when it fails", async () => {
    const { publicToken } = await published();
    expect(await submit({ token: publicToken, version: 1, answers: {}, captcha: "bot" })).toEqual({
      ok: false,
      error: "captcha",
    });
    expect(responses()).toHaveLength(0);
    expect(await submit({ token: publicToken, version: 1, answers: [], captcha: "x" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(captcha).toHaveBeenCalledTimes(1);
  });

  it("validates the answers on the server against the version", async () => {
    const { id, publicToken } = await published();
    const [name, rating] = await questionIds(id);
    expect(
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: "Ari", [rating!]: "Superb" },
        captcha: "human",
      }),
    ).toEqual({
      ok: false,
      error: "answers",
      fields: { [rating!]: "Choose one of the options." },
    });
    expect(
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: "Ari", [rating!]: "Good", q_injected: "x" },
        captcha: "human",
      }),
    ).toMatchObject({ ok: false, error: "answers", fields: { form: "Unknown question." } });
    expect(responses()).toHaveLength(0);
    expect(await submit({ token: publicToken, version: 9, answers: {}, captcha: "human" })).toEqual(
      { ok: false, error: "changed" },
    );
  });

  it("refuses unknown tokens, recruitment forms and answers outside the window", async () => {
    const { id, publicToken } = await published({
      opensAt: "2026-10-21T00:00:00.000Z",
      closesAt: "2026-10-22T00:00:00.000Z",
    });
    const [name, rating] = await questionIds(id);
    const answer = {
      token: publicToken,
      version: 1,
      answers: { [name!]: "Ari", [rating!]: "Good" },
      captcha: "human",
    };
    expect(await submit({ ...answer, token: "tokenUnknown0000000000000" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await submit(answer)).toEqual({ ok: false, error: "closed" });
    expect(await reader()(publicToken)).toMatchObject({ state: "upcoming" });
    clock = new Date("2026-10-21T10:00:00Z");
    expect(await submit(answer)).toEqual({ ok: true });
    clock = new Date("2026-10-22T00:00:00Z");
    expect(await submit(answer)).toEqual({ ok: false, error: "closed" });
    clock = new Date("2026-10-21T10:00:00Z");
    fake.docs.set(`forms/${id}`, { ...fake.docs.get(`forms/${id}`), usage: "recruitment" });
    expect(await submit(answer)).toEqual({ ok: false, error: "not_found" });
    expect(responses()).toHaveLength(1);
  });
});

describe("missing or malformed data", () => {
  it("treats a missing version, a malformed token and a missing count safely", async () => {
    const { id, publicToken } = await published();
    expect(await submit({ token: "../x", version: 1, answers: {}, captcha: "human" })).toEqual({
      ok: false,
      error: "not_found",
    });
    const form = { ...fake.docs.get(`forms/${id}`) };
    delete form["responseCount"];
    fake.docs.set(`forms/${id}`, form);
    expect(await store.get(id)).toMatchObject({ responseCount: 0 });
    fake.docs.delete(`formVersions/${id}_1`);
    expect(await reader()(publicToken)).toBeNull();
    expect(await submit({ token: publicToken, version: 1, answers: {}, captcha: "human" })).toEqual(
      { ok: false, error: "not_found" },
    );
    await actions().close(...as(owner))({ id, version: 2 });
    expect(await actions().publish(...as(owner))({ id, version: 3 })).toMatchObject({
      error: "refused",
      issues: ["Add at least one question."],
    });
  });
});

describe("responses and export (forms.responses, forms.export)", () => {
  it("lists responses newest first; the CSV export needs forms.export and is a security event", async () => {
    const { id, publicToken } = await published();
    const [name, rating] = await questionIds(id);
    for (const [i, who] of ["Ari", "=HYPERLINK(1)"].entries()) {
      clock = new Date(`2026-10-20T0${6 + i}:00:00Z`);
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: who, [rating!]: "Bad" },
        captcha: "human",
      });
    }
    expect((await store.listResponses(id, 10)).map((r) => r.answers[name!])).toEqual([
      "=HYPERLINK(1)",
      "Ari",
    ]);
    expect(await actions().exportResponses(...as(staff(["forms.responses"])))({ id })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(securityEvents).toHaveLength(0);
    const exported = await actions().exportResponses(...as(owner))({ id });
    expect(exported).toMatchObject({
      ok: true,
      data: {
        title: "Feedback Kongres 2026",
        header: ["Submitted at (UTC)", "Version", "Name", "E-mail", "Full name", "Rating"],
        rows: [
          ["2026-10-20T07:00:00.000Z", "1", "Guest", "guest@example.org", "=HYPERLINK(1)", "Bad"],
          ["2026-10-20T06:00:00.000Z", "1", "Guest", "guest@example.org", "Ari", "Bad"],
        ],
      },
    });
    expect(securityEvents).toEqual([{ actorId: "staff-1", details: { formId: id, responses: 2 } }]);
    expect(await actions().exportResponses(...as(owner))({ id: "missing" })).toMatchObject({
      ok: false,
      error: "refused",
    });
  });
});

describe("who may answer (10.3)", () => {
  const ari: Signed = { uid: "u1", email: "ari@example.org", name: "Ari Account" };
  const budi: Signed = { uid: "u2", email: "budi@example.org", name: null };
  const seed = () => {
    fake.docs.set("memberProfiles/u1", {
      userId: "u1",
      fullName: "Ari Wibowo",
      whatsappNumber: "+61400000000",
      university: "UGM",
      dateOfBirth: "2000-02-03",
      chapterId: "c1",
      privacyPolicyVersion: "x",
      consentedAt: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    });
    fake.docs.set("chapters/c1", { name: "PPI Sydney" });
  };
  const appoint = (userId: string, status = "active", periodId = "p1") => {
    fake.docs.set("orgUnits/desain", { path: [], type: "bidang" });
    fake.docs.set(`appointments/a-${userId}-${status}-${periodId}`, {
      userId,
      periodId,
      orgUnitId: "desain",
      status,
      seat: "head",
      title: "Kepala Bidang Desain",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    });
  };
  const answerNow = (token: string, ids: string[], user: Signed | null, name = "Ari") =>
    submit(
      { token, version: 1, answers: { [ids[0]!]: name, [ids[1]!]: "Good" }, captcha: "human" },
      user,
    );

  beforeEach(() => fake.docs.set("settings/activePeriod", { periodId: "p1" }));

  it("guest asks for name and e-mail and stores them; no sign-in needed", async () => {
    const { id, publicToken } = await published();
    const ids = await questionIds(id);
    expect(
      await submit({
        token: publicToken,
        version: 1,
        answers: { [ids[0]!]: "x", [ids[1]!]: "Good" },
        captcha: "human",
        guest: { name: "", email: "" },
      }),
    ).toEqual({ ok: false, error: "guest" });
    expect(await answerNow(publicToken, ids, null)).toEqual({ ok: true });
    expect(fake.docs.get(responses()[0]!)).toMatchObject({
      name: "Guest",
      email: "guest@example.org",
    });
    expect(fake.docs.get(responses()[0]!)).not.toHaveProperty("uid");
  });

  it("anonymous stores no identity, uid or profile even for a signed-in visitor", async () => {
    seed();
    const { id, publicToken } = await published({ respondents: "anonymous" });
    const ids = await questionIds(id);
    expect(await answerNow(publicToken, ids, ari)).toEqual({ ok: true });
    const row = fake.docs.get(responses()[0]!) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["answers", "formId", "submittedAt", "version"]);
  });

  it("account forms ask for sign-in, keep a copy of the profile and one editable response", async () => {
    seed();
    appoint("u1");
    const { id, publicToken } = await published({
      respondents: "account",
      profileFields: ["seat", "whatsapp", "chapter", "campus", "birthPlace", "birthDate"],
    });
    const ids = await questionIds(id);
    expect(await answerNow(publicToken, ids, null)).toEqual({ ok: false, error: "signin" });
    expect(responses()).toHaveLength(0);
    expect(await reader(ari)(publicToken)).toMatchObject({
      mine: {
        name: "Ari Wibowo",
        officer: true,
        answers: null,
        profile: { seat: "Kepala Bidang Desain", campus: "UGM", chapter: "PPI Sydney" },
      },
    });
    expect(await reader({ uid: "u4", email: null, name: null })(publicToken)).toMatchObject({
      mine: { name: "u4", email: "" },
    });
    expect(await answerNow(publicToken, ids, ari)).toEqual({ ok: true });
    expect(responses()).toEqual([`formResponses/${id}_u1`]);
    expect(fake.docs.get(`formResponses/${id}_u1`)).toMatchObject({
      uid: "u1",
      name: "Ari Wibowo",
      email: "ari@example.org",
      profile: {
        seat: "Kepala Bidang Desain",
        whatsapp: "+61400000000",
        chapter: "PPI Sydney",
        campus: "UGM",
        birthPlace: "",
        birthDate: "2000-02-03",
      },
    });
    fake.docs.set("memberProfiles/u1", {
      ...fake.docs.get("memberProfiles/u1"),
      university: "ITB",
    });
    expect(await answerNow(publicToken, ids, ari, "Ari B")).toEqual({ ok: true });
    expect(responses()).toHaveLength(1);
    expect(fake.docs.get(`formResponses/${id}_u1`)).toMatchObject({
      answers: { [ids[0]!]: "Ari B" },
      profile: { campus: "ITB" },
    });
    expect(await store.get(id)).toMatchObject({ responseCount: 1 });
    expect(await reader(ari)(publicToken)).toMatchObject({
      mine: { answers: { [ids[0]!]: "Ari B" } },
    });
    expect(await answerNow(publicToken, ids, budi)).toEqual({ ok: true });
    expect(await store.get(id)).toMatchObject({ responseCount: 2 });
    clock = new Date("2027-01-01T00:00:00Z");
    await actions().close(...as(owner))({ id, version: (await store.get(id))?.version ?? 0 });
    expect(await answerNow(publicToken, ids, ari)).toEqual({ ok: false, error: "closed" });
  });

  it("officers forms refuse accounts without an active seat in the active period", async () => {
    seed();
    appoint("u1", "ended");
    appoint("u1", "active", "p0");
    const { id, publicToken } = await published({ respondents: "officers" });
    const ids = await questionIds(id);
    expect(await answerNow(publicToken, ids, ari)).toEqual({ ok: false, error: "officers" });
    expect(await reader(ari)(publicToken)).toMatchObject({ mine: { officer: false } });
    expect(responses()).toHaveLength(0);
    appoint("u1");
    expect(await answerNow(publicToken, ids, ari)).toEqual({ ok: true });
    expect(await answerNow(publicToken, ids, budi)).toEqual({ ok: false, error: "officers" });
  });

  it("allows file questions on account forms only", async () => {
    const file = { questions: [question({ type: "file", label: "CV" })] };
    for (const [respondents, ok] of [
      ["account", true],
      ["guest", false],
    ] as const) {
      const saved = await actions().save(...as(owner))({
        ...formInput({ ...file, respondents }),
        version: null,
      });
      const result = await actions().publish(...as(owner))({
        id: saved.ok ? saved.data.id : "",
        version: 1,
      });
      expect(result.ok).toBe(ok);
    }
  });

  it("export adds name, e-mail and profile columns", async () => {
    seed();
    const { id, publicToken } = await published({
      respondents: "account",
      profileFields: ["campus"],
    });
    const ids = await questionIds(id);
    await answerNow(publicToken, ids, ari);
    const exported = await actions().exportResponses(...as(owner))({ id });
    expect(exported).toMatchObject({
      ok: true,
      data: {
        header: [
          "Submitted at (UTC)",
          "Version",
          "Name",
          "E-mail",
          "Profile: campus",
          "Full name",
          "Rating",
        ],
        rows: [[expect.any(String), "1", "Ari Wibowo", "ari@example.org", "UGM", "Ari", "Good"]],
      },
    });
  });
});

describe("own forms (forms.edit in a unit scope)", () => {
  const unitStaff = (userId: string): Principal => ({
    kind: "user",
    userId,
    active: true,
    assignments: [
      {
        roleId: "r",
        scope: { type: "orgUnit", orgUnitId: "design" },
        permissions: new Set(normalizePermissions(["forms.edit"])),
      },
    ],
  });

  it("a unit-scoped editor creates forms and changes only their own; global covers all", async () => {
    const mine = await actions().save(...as(unitStaff("w1")))({ ...formInput(), version: null });
    expect(mine).toMatchObject({ ok: true });
    const id = mine.ok ? mine.data.id : "";
    expect(await store.get(id)).toMatchObject({ createdBy: "w1" });
    expect(
      await actions().save(...as(unitStaff("w1")))({
        ...formInput({ title: "Renamed" }),
        id,
        version: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await actions().save(...as(unitStaff("w2")))({
        ...formInput({ title: "Hijack" }),
        id,
        version: 2,
      }),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(await actions().remove(...as(unitStaff("w2")))({ id, version: 2 })).toMatchObject({
      ok: false,
      error: "refused",
    });
    expect(
      await actions().save(...as(owner))({ ...formInput({ title: "By global" }), id, version: 2 }),
    ).toMatchObject({ ok: true });
    expect(await store.get(id)).toMatchObject({ createdBy: "w1", title: "By global" });
    expect(await actions().remove(...as(unitStaff("w1")))({ id, version: 3 })).toMatchObject({
      ok: true,
    });
  });
});
