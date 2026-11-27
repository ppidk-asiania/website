import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import {
  createSqlEventStore,
  createSqlFormStore,
  createSqlFormWebStore,
  createSqlRegistrationStore,
} from "@website/db/sql";
import type { EventEntity, EventFee } from "@website/domain/events";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createFormActions } from "../../apps/admin/src/server/forms";
import {
  createEventFormRegistration,
  createFormRegistrationTransaction,
} from "../../apps/web/src/server/registrations";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlEventStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
const staff: Principal = {
  kind: "user",
  userId: "staff-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(["forms.edit", "forms.publish"])),
    },
  ],
};
const context = () =>
  Promise.resolve({ actorEmail: "x@example.org", requestId: "req-123456", authTime: null });
const as = [() => Promise.resolve(staff), context] as const;
let auditSeq = 0;
const auditStub = (): AuditEvent => ({
  id: `audit-${++auditSeq}`,
  occurredAt: now,
  actor: { type: "system", id: "test" },
  action: "CREATE",
  resourceType: "event",
  resourceId: "x",
  operationId: "op",
  before: null,
  after: null,
  versionBefore: null,
  versionAfter: 1,
  revertible: false,
  revertOf: null,
  request: { requestId: "req-123456" },
  prevHash: null,
  hash: null,
});

const question = (extra: Record<string, unknown> = {}) => ({
  id: "",
  type: "single_choice",
  label: "T-shirt size",
  description: "",
  required: true,
  options: ["S", "M", "L"],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});

let fake: ReturnType<typeof fakeDb>;
let events: ReturnType<typeof createSqlEventStore>;
let registrations: ReturnType<typeof createSqlRegistrationStore>;
let forms: ReturnType<typeof createSqlFormWebStore>;
let formId = "";
let questionId = "";
let version = 1;
let eventId = "";
const sent: string[] = [];
const db = () => fake.db as unknown as Db;

const event = (
  fields: Partial<Omit<EventEntity, "id" | "version" | "createdAt" | "updatedAt">> = {},
) => ({
  slug: "simposium",
  title: "Simposium",
  summary: null,
  startsAt: new Date("2026-11-20T02:00:00Z"),
  endsAt: null,
  timezone: "Asia/Tokyo",
  location: "Tokyo",
  chapterId: null,
  published: true,
  capacity: null,
  registrationClosesAt: new Date("2026-11-19T00:00:00Z"),
  type: "seminar" as const,
  description: "D",
  bannerImage: null,
  registrationUrl: null,
  schedule: [],
  speakers: [],
  sponsors: [],
  deletedAt: null,
  publishAt: null,
  approvalRequestedAt: null,
  approvalRequestedBy: null,
  approvedAt: null,
  approvedBy: null,
  rejectionNote: null,
  cancelledAt: null,
  cancelReason: null,
  finalAttendance: null,
  attendanceNote: null,
  recapUrl: null,
  registration: {
    formId,
    attendanceModes: ["online", "onsite"] as const,
    showOnTicket: "",
    shortUrl: null,
  },
  fee: null,
  ...fields,
});

const register = (
  uid: string,
  input: Record<string, unknown> = {},
  when = now,
  user = { uid, email: `${uid}@example.org` },
) =>
  createEventFormRegistration({
    findEvent: async (slug) => {
      const found = await createSqlEventStore(db()).findBySlug(slug);
      return found && (await import("@website/domain/events")).toPublicEvent(found);
    },
    registerWithForm: createFormRegistrationTransaction({ forms, registrations }),
    captcha: (token) => Promise.resolve(token === "human"),
    send: (_message, key) => Promise.resolve(void sent.push(key)),
    profileComplete: () => Promise.resolve(true),
    now: () => when,
  })(
    user,
    {
      slug: "simposium",
      version,
      attendanceMode: "online",
      answers: { [questionId]: "M" },
      token: "human",
      ...input,
    },
    "en",
  );

const fee: EventFee = {
  paid: true,
  currency: "CNY",
  categories: [
    { id: "std", label: "Student", amountMinor: 5000, earlyAmountMinor: null, quota: 2 },
    { id: "pro", label: "Professional", amountMinor: 9000, earlyAmountMinor: null, quota: null },
  ],
  earlyUntil: null,
  instructions: "",
  payImage: null,
};

const docs = (prefix: string) => [...fake.docs.keys()].filter((path) => path.startsWith(prefix));

beforeEach(async () => {
  fake = fakeDb();
  sent.length = 0;
  events = createSqlEventStore(db());
  registrations = createSqlRegistrationStore(db());
  forms = createSqlFormWebStore(db());
  const actions = createFormActions({
    forms: createSqlFormStore(db()),
    now: () => now,
    uuid: () => crypto.randomUUID(),
    token: () => "token00000000000000000001",
    logExport: () => undefined,
  });
  const saved = await actions.save(...as)({
    title: "Registration questions",
    description: "",
    usage: "public",
    respondents: "account",
    profileFields: ["campus"],
    opensAt: null,
    closesAt: null,
    questions: [question()],
    version: null,
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  formId = saved.data.id;
  await actions.publish(...as)({ id: formId, version: 1 });
  const stored = await createSqlFormStore(db()).getVersion(formId, 1);
  questionId = stored?.questions[0]?.id ?? "";
  version = 1;
  eventId = (await events.write(null, null, () => event(), auditStub, now)).id;
});

describe("registering with the event's questions (N1.2)", () => {
  it("writes the registration and the form response in one go", async () => {
    expect(await register("u1")).toEqual({ ok: true, status: "confirmed", practice: false });
    expect(fake.docs.get(`eventRegistrations/${eventId}_u1`)).toMatchObject({
      status: "confirmed",
      attendanceMode: "online",
      responseId: `${formId}_u1`,
      formVersion: 1,
    });
    expect(fake.docs.get(`formResponses/${formId}_u1`)).toMatchObject({
      uid: "u1",
      answers: { [questionId]: "M" },
      profile: { campus: "" },
    });
    expect(sent).toEqual([`event:${eventId}:registered:u1`]);
  });

  it("is refused as a whole: bad answers or a missing mode write nothing", async () => {
    expect(await register("u1", { answers: { [questionId]: "XXL" } })).toMatchObject({
      ok: false,
      error: "answers",
    });
    expect(await register("u1", { answers: {} })).toMatchObject({ error: "answers" });
    expect(await register("u1", { attendanceMode: null })).toEqual({ ok: false, error: "mode" });
    expect(await register("u1", { version: 2 })).toEqual({ ok: false, error: "changed" });
    expect(docs("eventRegistrations/")).toEqual([]);
    expect(docs("formResponses/")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a closed registration rolls the answers back too", async () => {
    expect(await register("u1", {}, new Date("2026-11-19T00:00:00Z"))).toEqual({
      ok: false,
      error: "closed",
    });
    expect(docs("formResponses/")).toEqual([]);
  });

  it("practice mode validates and stores nothing", async () => {
    expect(await register("u1", { practice: true })).toEqual({
      ok: true,
      status: "confirmed",
      practice: true,
    });
    expect(await register("u1", { practice: true, answers: {} })).toMatchObject({
      error: "answers",
    });
    expect(docs("eventRegistrations/")).toEqual([]);
    expect(docs("formResponses/")).toEqual([]);
    expect(docs("eventCounters/")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("capacity still holds when many register at once", async () => {
    const other = await events.write(
      null,
      null,
      () => event({ slug: "small", capacity: 2 }),
      auditStub,
      now,
    );
    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((uid) => register(uid, { slug: "small" })),
    );
    expect(results.filter((r) => r.ok && r.status === "confirmed")).toHaveLength(2);
    expect(results.filter((r) => r.ok && r.status === "waitlisted")).toHaveLength(3);
    expect(fake.docs.get(`eventCounters/${other.id}`)).toMatchObject({
      confirmed: 2,
      waitlisted: 3,
    });
  });

  it("a second submit changes the answers but not the place", async () => {
    await register("u1");
    expect(await register("u1", { answers: { [questionId]: "L" } })).toMatchObject({ ok: true });
    expect(docs("eventRegistrations/")).toHaveLength(1);
    expect(fake.docs.get(`formResponses/${formId}_u1`)).toMatchObject({
      answers: { [questionId]: "L" },
    });
    expect(fake.docs.get(`eventCounters/${eventId}`)).toMatchObject({ confirmed: 1 });
  });

  it("an event with questions refuses the one-click registration, one without refuses answers", async () => {
    await expect(registrations.register(eventId, "u1", now)).rejects.toThrow(/asks questions/);
    await events.write(
      null,
      null,
      () => event({ slug: "plain", registration: null }),
      auditStub,
      now,
    );
    expect(await register("u1", { slug: "plain" })).toEqual({ ok: false, error: "invalid" });
    await expect(
      registrations.register((await events.findBySlug("plain"))!.id, "u2", now),
    ).resolves.toMatchObject({ created: true });
  });

  it("needs a signed-in member, a human and an event that is public", async () => {
    expect(
      await createEventFormRegistration({
        findEvent: () => Promise.resolve(null),
        registerWithForm: createFormRegistrationTransaction({ forms, registrations }),
        captcha: () => Promise.resolve(true),
        send: () => Promise.resolve(),
        profileComplete: () => Promise.resolve(true),
        now: () => now,
      })(null, {}, "en"),
    ).toEqual({ ok: false, error: "signin" });
    expect(await register("u1", { token: "bot" })).toEqual({ ok: false, error: "captcha" });
    expect(await register("u1", { slug: "missing" })).toEqual({ ok: false, error: "closed" });
    expect(await register("u1", { extra: 1 })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("a paid event through its form (N1.3)", () => {
  beforeEach(async () => {
    await events.write(null, null, () => event({ slug: "paid", fee }), auditStub, now);
  });

  it("needs one of its ticket categories, holds the seat as pending, and a full category is refused", async () => {
    expect(await register("u1", { slug: "paid" })).toEqual({ ok: false, error: "category" });
    expect(await register("u1", { slug: "paid", feeCategory: "vip" })).toEqual({
      ok: false,
      error: "category",
    });
    expect(await register("u1", { slug: "paid", feeCategory: "std" })).toEqual({
      ok: true,
      status: "pending",
      practice: false,
    });
    await register("u2", { slug: "paid", feeCategory: "std" });
    expect(await register("u3", { slug: "paid", feeCategory: "std" })).toEqual({
      ok: false,
      error: "category",
    });
    expect(docs("formResponses/")).toHaveLength(2);
    expect(sent).toHaveLength(2);
  });

  it("a free event refuses a category", async () => {
    expect(await register("u1", { feeCategory: "std" })).toEqual({ ok: false, error: "category" });
  });
});

describe("the registration transaction on its own", () => {
  const user = { uid: "u1", email: "u1@example.org" };
  const answers = { version: 1, attendanceMode: "online" as const, feeCategory: null, answers: {} };
  const run = (
    forms: Partial<Parameters<typeof createFormRegistrationTransaction>[0]["forms"]>,
    stored: Partial<Parameters<typeof createFormRegistrationTransaction>[0]["registrations"]> = {},
    practice = false,
  ) =>
    createFormRegistrationTransaction({
      forms: { tokenOf: () => Promise.resolve("token"), ...forms } as never,
      registrations: { setupOf: (id: string) => registrations.setupOf(id), ...stored } as never,
    })({ id: eventId, fee: null }, user, answers, now, practice);

  it("refuses a form that has no public token", async () => {
    expect(await run({ tokenOf: () => Promise.resolve(null) })).toEqual({
      ok: false,
      error: "closed",
    });
  });

  it("practice mode needs an open form on the same version", async () => {
    const found = (state: string, number: number) => () =>
      Promise.resolve({ state, version: { number, questions: [] } }) as never;
    expect(await run({ findPublic: () => Promise.resolve(null) }, {}, true)).toEqual({
      ok: false,
      error: "closed",
    });
    expect(await run({ findPublic: found("closed", 1) }, {}, true)).toEqual({
      ok: false,
      error: "closed",
    });
    expect(await run({ findPublic: found("open", 2) }, {}, true)).toEqual({
      ok: false,
      error: "changed",
    });
  });

  it("maps a refused submit to the sign-in or closed message", async () => {
    const refused = (error: "signin" | "guest") => ({
      submit: () => Promise.resolve({ ok: false as const, error }),
    });
    expect(await run(refused("signin"))).toEqual({ ok: false, error: "signin" });
    expect(await run(refused("guest"))).toEqual({ ok: false, error: "closed" });
  });

  it("treats a submit that never reached the registration as closed", async () => {
    expect(await run({ submit: () => Promise.resolve({ ok: true }) })).toEqual({
      ok: false,
      error: "closed",
    });
  });

  it("does not hide an unexpected failure of the registration", async () => {
    const submit = async (...args: unknown[]) => {
      const alongside = args[5] as (tx: never, saved: unknown) => Promise<void>;
      await alongside(undefined as never, { responseId: null, version: 1 });
      return { ok: true as const };
    };
    await expect(
      run({ submit }, { registerIn: () => Promise.reject(new Error("db down")) }),
    ).rejects.toThrow("db down");
  });
});

describe("the member's profile", () => {
  it("must be complete before registering", async () => {
    expect(
      await createEventFormRegistration({
        findEvent: () => Promise.resolve(null),
        registerWithForm: createFormRegistrationTransaction({ forms, registrations }),
        captcha: () => Promise.resolve(true),
        send: () => Promise.resolve(),
        profileComplete: () => Promise.resolve(false),
        now: () => now,
      })(
        { uid: "u1", email: null },
        { slug: "simposium", version: 1, attendanceMode: null, answers: {}, token: "t" },
        "en",
      ),
    ).toEqual({ ok: false, error: "profile" });
  });
});
