import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlApplicationStore,
  createSqlInterviewStore,
  createSqlRecruitmentStore,
  createSqlRecruitmentWebStore,
} from "@website/db/sql";
import { assessmentSummary, DEFAULT_RUBRIC, interviewScope } from "@website/domain/recruitment";
import type { ActiveSeat } from "@website/domain/organizations";
import { utcToWallTime } from "@website/domain/shared";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createApplicationActions } from "../../apps/admin/src/server/applications";
import {
  createInterviewActions,
  createInterviewNotices,
  createInterviewReads,
  createInterviewReminders,
} from "../../apps/admin/src/server/interviews";
import { createBookedNotice } from "../../apps/web/src/server/interview-notice";
import { createRecruitmentActions } from "../../apps/admin/src/server/recruitment";
import { createApplying } from "../../apps/web/src/server/recruitment";
import { fakeDb } from "../support/fake-db";
import { noRatification } from "../support/recruitment";

type Db = Parameters<typeof createSqlInterviewStore>[0];
let clock = new Date("2026-11-10T05:00:00Z");
const staff = (permissions: string[], userId = "committee-1"): Principal => ({
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
const reviewer = staff(["recruitment.review"]);
const context = () =>
  Promise.resolve({ actorEmail: "oprec@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeDb>;
const db = () => fake.db as unknown as Db;
const units = [
  { id: "dir", path: [] },
  { id: "finance", path: ["dir"] },
  { id: "media", path: ["dir"] },
];
const seat = (orgUnitId: string, unitType: ActiveSeat["unitType"], kind: ActiveSeat["seat"]) =>
  ({
    orgUnitId,
    orgUnitPath: [...(units.find((u) => u.id === orgUnitId)?.path ?? []), orgUnitId],
    unitType,
    seat: kind,
  }) satisfies ActiveSeat;
const seats: Record<string, ActiveSeat[]> = {
  "head-fin": [seat("finance", "divisi", "head")],
  "head-dir": [seat("dir", "direktorat", "head")],
  "member-fin": [seat("finance", "divisi", "member")],
};
const scopeOf = (uid: string) =>
  Promise.resolve(
    interviewScope({
      seats: seats[uid] ?? [],
      units,
      review: uid === "committee-1",
      granted: uid === "granted-media" ? ["media"] : [],
    }),
  );
// an officer who only holds a seat: no recruitment permission at all
const holder = (uid: string) => staff(["calendar.read"], uid);
const sent: Array<{ key: string; to: string | null; text: string }> = [];
const send = (message: { to: string | null; text: string }, key: string) => {
  if (sent.some((m) => m.key === key)) return Promise.resolve("duplicate" as const);
  sent.push({ key, to: message.to, text: message.text });
  return Promise.resolve("sent" as const);
};
const contacts = (uids: readonly string[]) =>
  Promise.resolve(
    new Map(
      uids.map((u) => [u, { email: `${u}@x.org`, phone: null, timeZone: "Asia/Jakarta" }] as const),
    ),
  );
const notices = () =>
  createInterviewNotices({
    contacts,
    send,
    webUrl: "https://web.example",
    adminUrl: "https://admin.example",
  });
const interviews = () =>
  createInterviewActions({
    interviews: createSqlInterviewStore(db()),
    applications: createSqlApplicationStore(db()),
    scope: scopeOf,
    notices: notices(),
    now: () => clock,
  });
const web = () => createSqlRecruitmentWebStore(db());
const applying = () =>
  createApplying({
    notifyBooked: createBookedNotice({
      contacts,
      send,
      adminUrl: "https://admin.example",
    }).booked,
    store: web(),
    profileComplete: () => Promise.resolve(true),
    hasProof: () => Promise.resolve(true),
    storage: { save: () => Promise.resolve({ url: null }) },
    now: () => clock,
    uuid: () => "abcdef12-0000-4000-8000-000000000000",
  });
let recruitmentId = "";
const plan = {
  date: "2026-11-15",
  timeZone: "Asia/Tokyo",
  startTime: "09:00",
  endTime: "10:00",
  durationMinutes: 30,
  gapMinutes: 0,
  breaks: [],
  capacity: 1,
  location: "https://meet.example/oprec",
};
const slots = () => createSqlInterviewStore(db()).listForRecruitment(recruitmentId);
const booked = (id: string) => fake.docs.get(`interviewSlots/${id}`)?.["booked"];

const inInterview = async (uid: string, choices = ["finance"]) => {
  await applying().saveDraft({ uid }, { recruitmentId, choices, answers: {} });
  await applying().submit({ uid }, { recruitmentId });
  const version = fake.docs.get(`applications/${recruitmentId}_${uid}`)?.["version"] as number;
  await createApplicationActions({
    applications: createSqlApplicationStore(db()),
    signedUrl: () => Promise.resolve(""),
    ...noRatification,
    now: () => clock,
  }).pass(...as(reviewer))({ id: `${recruitmentId}_${uid}`, version });
};

beforeEach(async () => {
  clock = new Date("2026-11-10T05:00:00Z");
  fake = fakeDb();
  sent.length = 0;
  fake.docs.set("periods/p2026", { name: "2026/2027", status: "active", deletedAt: null });
  fake.docs.set("orgUnits/dir", {
    periodId: "p2026",
    name: "Direktorat",
    type: "direktorat",
    path: [],
    deletedAt: null,
  });
  fake.docs.set("orgUnits/finance", {
    periodId: "p2026",
    name: "Keuangan",
    type: "divisi",
    path: ["dir"],
    deletedAt: null,
  });
  fake.docs.set("orgUnits/media", {
    periodId: "p2026",
    name: "Media",
    type: "divisi",
    path: ["dir"],
    deletedAt: null,
  });
  fake.docs.set("forms/form1", { usage: "recruitment", currentVersion: 1, deletedAt: null });
  fake.docs.set("formVersions/form1_1", {
    formId: "form1",
    number: 1,
    answered: false,
    questions: [],
  });
  const committee = staff(["recruitment.edit"]);
  const actions = createRecruitmentActions({
    send: () => Promise.resolve("logged" as const),
    recruitments: createSqlRecruitmentStore(db()),
    now: () => clock,
  });
  const created = await actions.save(...as(committee))({
    periodId: "p2026",
    title: "Oprec 2026",
    description: "",
    opensAt: "2026-11-01T00:00:00.000Z",
    closesAt: "2026-11-20T00:00:00.000Z",
    maxChoices: 2,
    offerDays: 3,
    formId: "form1",
    units: [
      { orgUnitId: "finance", quota: 3, portfolioRequired: false },
      { orgUnitId: "media", quota: 3, portfolioRequired: false },
    ],
    version: null,
  });
  recruitmentId = created.ok ? created.data.id : "";
  await actions.setPublished(...as(committee))({ id: recruitmentId, version: 1, published: true });
});

describe("interview times (recruitment.review)", () => {
  it("creates UTC slots from a day plan; shown in the applicant's own zone", async () => {
    expect(
      await interviews().createPlan(...as(staff(["recruitment.offer"])))({ recruitmentId, plan }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await interviews().createPlan(...as(reviewer))({ recruitmentId, plan })).toEqual({
      ok: true,
      data: { created: 2 },
    });
    const list = await slots();
    expect(list.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-11-15T00:00:00.000Z",
      "2026-11-15T00:30:00.000Z",
    ]);
    expect(utcToWallTime(list[0]!.startsAt, "Asia/Jakarta")).toBe("2026-11-15T07:00");
    expect(list[0]).toMatchObject({ capacity: 1, booked: 0, location: plan.location });
    const entry = [...fake.docs.values()].find((d) => d["resourceType"] === "interviewSlot");
    expect(entry).toMatchObject({ action: "CREATE", revertible: false });
  });

  it("skips past times and refuses a plan with none left, or an unknown recruitment", async () => {
    clock = new Date("2026-11-15T00:10:00Z");
    expect(await interviews().createPlan(...as(reviewer))({ recruitmentId, plan })).toEqual({
      ok: true,
      data: { created: 1 },
    });
    clock = new Date("2026-11-16T00:00:00Z");
    expect(await interviews().createPlan(...as(reviewer))({ recruitmentId, plan })).toMatchObject({
      error: "refused",
      issues: ["No interview time is in the future."],
    });
    expect(
      await interviews().createPlan(...as(reviewer))({ recruitmentId: "missing", plan }),
    ).toMatchObject({ error: "refused" });
  });
});

describe("booking an interview (applicant in `interview`)", () => {
  beforeEach(async () => {
    await interviews().createPlan(...as(reviewer))({ recruitmentId, plan });
  });

  it("only applicants in the interview step book", async () => {
    const [first] = await slots();
    await applying().saveDraft(
      { uid: "ari" },
      { recruitmentId, choices: ["finance"], answers: {} },
    );
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: first!.id },
      ),
    ).toEqual({ ok: false, error: "locked" });
    expect(
      await applying().bookInterview(null, {
        recruitmentId,
        choiceId: "finance",
        slotId: first!.id,
      }),
    ).toEqual({
      ok: false,
      error: "signin",
    });
    expect(
      await applying().bookInterview(
        { uid: "nobody" },
        { recruitmentId, choiceId: "finance", slotId: first!.id },
      ),
    ).toEqual({ ok: false, error: "locked" });
    expect(await interviews().removeSlot(...as(reviewer))({ id: "nope" })).toMatchObject({
      error: "refused",
      issues: ["This interview time does not exist."],
    });
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId: "missing", choiceId: "finance", slotId: first!.id },
      ),
    ).toEqual({ ok: false, error: "closed" });
  });

  it("never exceeds a slot's capacity under concurrent bookings", async () => {
    const [first] = await slots();
    for (const uid of ["ari", "budi", "cici"]) await inInterview(uid);
    const results = await Promise.all(
      ["ari", "budi", "cici"].map((uid) =>
        applying().bookInterview(
          { uid },
          { recruitmentId, choiceId: "finance", slotId: first!.id },
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "refused", message: "This interview time is full." },
      { ok: false, error: "refused", message: "This interview time is full." },
    ]);
    expect(booked(first!.id)).toBe(1);
  });

  it("keeps ONE active booking: re-booking frees the old time in the same transaction", async () => {
    const [first, second] = await slots();
    await inInterview("ari");
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: first!.id },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: first!.id },
      ),
    ).toMatchObject({ ok: true });
    expect(booked(first!.id)).toBe(1);
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: second!.id },
      ),
    ).toMatchObject({ ok: true });
    expect([booked(first!.id), booked(second!.id)]).toEqual([0, 1]);
    expect((await web().ownApplication(recruitmentId, "ari"))?.interviews).toEqual({
      finance: {
        slotId: second!.id,
        startsAt: second!.startsAt,
        attendance: null,
        attendanceNote: null,
      },
    });
    expect(await interviews().removeSlot(...as(reviewer))({ id: second!.id })).toMatchObject({
      error: "refused",
      issues: ["Someone booked this time; it stays."],
    });
    expect(await interviews().removeSlot(...as(reviewer))({ id: first!.id })).toMatchObject({
      ok: true,
    });
    expect((await slots()).map((s) => s.id)).toEqual([second!.id]);
    expect(await interviews().removeSlot(...as(reviewer))({ id: first!.id })).toMatchObject({
      error: "refused",
    });
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: first!.id },
      ),
    ).toEqual({
      ok: false,
      error: "refused",
      message: "This interview time is no longer available.",
    });
  });

  it("refuses past times and times of another recruitment; a lost old slot is skipped", async () => {
    const [first, second] = await slots();
    await inInterview("ari");
    fake.docs.set("interviewSlots/foreign", {
      ...fake.docs.get(`interviewSlots/${first!.id}`),
      recruitmentId: "other",
    });
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: "foreign" },
      ),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: "nope" },
      ),
    ).toMatchObject({ ok: false, error: "refused" });
    await applying().bookInterview(
      { uid: "ari" },
      { recruitmentId, choiceId: "finance", slotId: first!.id },
    );
    fake.docs.delete(`interviewSlots/${first!.id}`);
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: second!.id },
      ),
    ).toMatchObject({ ok: true });
    expect((await web().slots(recruitmentId)).map((s) => s.id)).toEqual([second!.id]);
    clock = new Date("2026-11-15T00:30:00Z");
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId, choiceId: "finance", slotId: "foreign" },
      ),
    ).toMatchObject({ ok: false, error: "refused" });
  });
});

const mine = (orgUnitId: string, overrides: Record<string, unknown> = {}) => ({
  recruitmentId,
  orgUnitId,
  plan: { ...plan, location: "https://meet.example/fin", note: "Bring your CV", ...overrides },
});
const applicationOf = (uid: string) => fake.docs.get(`applications/${recruitmentId}_${uid}`);
const book = (uid: string, choiceId: string, slotId: string) =>
  applying().bookInterview({ uid }, { recruitmentId, choiceId, slotId });
const cancel = (uid: string, choiceId: string) =>
  applying().cancelInterview({ uid }, { recruitmentId, choiceId });
const slotOf = (id: string) => fake.docs.get(`interviewSlots/${id}`);

describe("interviewers open their own times", () => {
  it("a division head (seat only, no recruitment permission) opens slots for the own unit", async () => {
    const result = await interviews().createMine(...as(holder("head-fin")))(mine("finance"));
    expect(result).toEqual({ ok: true, data: { created: 2 } });
    const [first] = await slots();
    expect(first).toMatchObject({
      interviewerUid: "head-fin",
      orgUnitId: "finance",
      timeZone: "Asia/Tokyo",
      mode: "online",
      location: "https://meet.example/fin",
      note: "Bring your CV",
      capacity: 1,
      bookingCutoffHours: 12,
      version: 1,
    });
    const entry = [...fake.docs.values()].find((d) => d["resourceType"] === "interviewSlot");
    expect(entry).toMatchObject({ action: "CREATE", revertible: false });
  });

  it("refuses another unit, a member seat, and an account without any scope", async () => {
    expect(await interviews().createMine(...as(holder("head-fin")))(mine("media"))).toMatchObject({
      error: "refused",
    });
    expect(await interviews().createMine(...as(holder("member-fin")))(mine("finance"))).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await interviews().createMine(...as(holder("nobody")))(mine("finance"))).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await slots()).toEqual([]);
  });

  it("a directorate head opens slots for the directorate; recruitment.interview works too", async () => {
    expect(await interviews().createMine(...as(holder("head-dir")))(mine("dir"))).toMatchObject({
      ok: true,
    });
    const granted = staff(["recruitment.interview"], "granted-media");
    expect(await interviews().createMine(...as(granted))(mine("media"))).toMatchObject({
      ok: true,
    });
    expect(await interviews().createMine(...as(granted))(mine("finance"))).toMatchObject({
      error: "refused",
    });
  });
});

describe("one interview per chosen unit", () => {
  beforeEach(async () => {
    await interviews().createMine(...as(holder("head-fin")))(mine("finance"));
    await interviews().createMine(...as(holder("head-dir")))(mine("dir"));
  });
  const slotsOfUnit = async (unit: string) => (await slots()).filter((s) => s.orgUnitId === unit);

  it("books one time per choice and tells the interviewer once", async () => {
    await inInterview("ari", ["finance", "media"]);
    const [fin] = await slotsOfUnit("finance");
    const [dir] = await slotsOfUnit("dir");
    expect(await book("ari", "finance", fin!.id)).toMatchObject({ ok: true });
    // the directorate's time serves the choice "media" (a unit below it)
    expect(await book("ari", "media", dir!.id)).toMatchObject({ ok: true });
    expect(Object.keys(applicationOf("ari")?.["interviews"] as object).sort()).toEqual([
      "finance",
      "media",
    ]);
    expect([booked(fin!.id), booked(dir!.id)]).toEqual([1, 1]);
    expect(sent.map((m) => [m.key, m.to])).toEqual([
      [`interview:${recruitmentId}_ari:booked:${fin!.id}`, "head-fin@x.org"],
      [`interview:${recruitmentId}_ari:booked:${dir!.id}`, "head-dir@x.org"],
    ]);
    expect(sent[0]!.text).toContain("07:00");
  });

  it("refuses a time that is not offered for the choice, or a unit that was not chosen", async () => {
    await inInterview("ari", ["finance", "media"]);
    const [fin] = await slotsOfUnit("finance");
    expect(await book("ari", "media", fin!.id)).toMatchObject({
      ok: false,
      error: "refused",
      message: "This interview time is not offered for this choice.",
    });
    expect(await book("ari", "dir", fin!.id)).toMatchObject({ ok: false, error: "refused" });
    expect(booked(fin!.id)).toBe(0);
  });

  it("a committee time (no unit) is offered for every choice", async () => {
    await interviews().createPlan(...as(reviewer))({ recruitmentId, plan });
    await inInterview("ari", ["finance", "media"]);
    const open = (await slots()).find((s) => s.orgUnitId === null)!;
    expect(await book("ari", "media", open.id)).toMatchObject({ ok: true });
  });

  it("lets an applicant change or cancel ONCE; the second change is refused", async () => {
    await inInterview("ari");
    const [a, b] = await slotsOfUnit("finance");
    await book("ari", "finance", a!.id);
    expect(await book("ari", "finance", b!.id)).toMatchObject({ ok: true });
    expect(await book("ari", "finance", a!.id)).toEqual({
      ok: false,
      error: "refused",
      message: "You can change or cancel an interview once.",
    });
    expect(await cancel("ari", "finance")).toMatchObject({ ok: false, error: "refused" });
    expect([booked(a!.id), booked(b!.id)]).toEqual([0, 1]);
  });

  it("a cancel spends the one change; booking again afterwards is final", async () => {
    await inInterview("ari");
    const [a, b] = await slotsOfUnit("finance");
    await book("ari", "finance", a!.id);
    expect(await cancel("ari", "finance")).toMatchObject({ ok: true });
    expect(booked(a!.id)).toBe(0);
    expect(applicationOf("ari")?.["interviews"]).toEqual({});
    expect(await book("ari", "finance", b!.id)).toMatchObject({ ok: true });
    expect(await cancel("ari", "finance")).toMatchObject({ ok: false, error: "refused" });
    expect(await cancel("ari", "media")).toMatchObject({ ok: false, error: "refused" });
  });

  it("never after the cut-off, for a new booking, a change or a cancel", async () => {
    await inInterview("ari");
    const [a, b] = await slotsOfUnit("finance");
    await book("ari", "finance", a!.id);
    clock = new Date("2026-11-14T13:00:00Z"); // 11 hours before 2026-11-15T00:00Z, cut-off 12 h
    expect(await book("ari", "finance", b!.id)).toMatchObject({
      ok: false,
      error: "refused",
      message: "Booking for this interview time has closed.",
    });
    expect(await cancel("ari", "finance")).toEqual({
      ok: false,
      error: "refused",
      message: "The time to change this interview has closed.",
    });
    expect(booked(a!.id)).toBe(1);
    await inInterview("budi");
    expect(await book("budi", "finance", b!.id)).toEqual({
      ok: false,
      error: "refused",
      message: "Booking for this interview time has closed.",
    });
  });

  it("a recorded interview cannot be changed or cancelled", async () => {
    await inInterview("ari");
    const [a, b] = await slotsOfUnit("finance");
    await book("ari", "finance", a!.id);
    expect(
      await interviews().markAttendance(...as(holder("head-fin")))({
        id: `${recruitmentId}_ari`,
        choiceId: "finance",
        attendance: "attended",
        note: "",
        version: applicationOf("ari")?.["version"] as number,
      }),
    ).toMatchObject({ ok: true });
    expect(await book("ari", "finance", b!.id)).toEqual({
      ok: false,
      error: "refused",
      message: "This interview was recorded; it cannot be changed.",
    });
    expect(await cancel("ari", "finance")).toMatchObject({ ok: false, error: "refused" });
  });

  it("books under concurrency without passing the capacity", async () => {
    const [a] = await slotsOfUnit("finance");
    for (const uid of ["ari", "budi", "cici"]) await inInterview(uid);
    const results = await Promise.all(
      ["ari", "budi", "cici"].map((u) => book(u, "finance", a!.id)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(booked(a!.id)).toBe(1);
  });
});

describe("attendance (committee, or the interviewer of the slot)", () => {
  beforeEach(async () => {
    await interviews().createMine(...as(holder("head-fin")))(mine("finance"));
    await inInterview("ari");
  });
  const mark = (principal: Principal, attendance: "attended" | "absent", note = "") =>
    interviews().markAttendance(...as(principal))({
      id: `${recruitmentId}_ari`,
      choiceId: "finance",
      attendance,
      note,
      version: applicationOf("ari")?.["version"] as number,
    });

  it("refuses without a booking and for a stranger; records for the committee", async () => {
    expect(await mark(reviewer, "attended")).toMatchObject({ error: "refused" });
    const [a] = await slots();
    await book("ari", "finance", a!.id);
    expect(await mark(holder("head-dir"), "absent")).toMatchObject({ error: "refused" });
    expect(await mark(staff(["recruitment.offer"], "offer-1"), "absent")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await mark(reviewer, "absent", "no show")).toMatchObject({ ok: true });
    const booking = (applicationOf("ari")?.["interviews"] as Record<string, unknown>)["finance"];
    expect(booking).toMatchObject({ attendance: "absent", attendanceNote: "no show" });
  });
});

describe("rules of a booked slot", () => {
  let slotId = "";
  beforeEach(async () => {
    await interviews().createMine(...as(holder("head-fin")))(mine("finance"));
    slotId = (await slots())[0]!.id;
    await inInterview("ari");
    await book("ari", "finance", slotId);
    sent.length = 0;
  });
  const change = (principal: Principal, patch: Record<string, unknown>) =>
    interviews().updateSlot(...as(principal))({ id: slotId, ...patch });

  it("is not moved, not shrunk, not deleted; only the owner (or the committee) edits", async () => {
    const head = holder("head-fin");
    expect(await change(head, { startsAt: "2026-11-15T03:00:00.000Z" })).toMatchObject({
      error: "refused",
      issues: ["Someone booked this time; it cannot be moved."],
    });
    expect(await change(head, { durationMinutes: 45 })).toMatchObject({ error: "refused" });
    expect(await change(head, { capacity: 1 })).toMatchObject({ ok: true });
    expect(await interviews().removeSlot(...as(reviewer))({ id: slotId })).toMatchObject({
      error: "refused",
      issues: ["Someone booked this time; it stays."],
    });
    expect(await change(holder("head-dir"), { note: "x" })).toMatchObject({ error: "refused" });
    expect(await change(holder("nobody"), { note: "x" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("changes link and note, tells the booked applicant once with the version in the key", async () => {
    expect(
      await change(holder("head-fin"), { location: "https://meet.example/new", note: "Room B" }),
    ).toMatchObject({ ok: true });
    expect(slotOf(slotId)).toMatchObject({ location: "https://meet.example/new", version: 2 });
    expect(sent.map((m) => m.key)).toEqual([`interview:${recruitmentId}_ari:changed:2`]);
    expect(sent[0]!.to).toBe("ari@x.org");
    expect(sent[0]!.text).toContain("https://meet.example/new");
  });

  it("sends nothing when nothing really changed, or when only the capacity grows", async () => {
    expect(await change(holder("head-fin"), { note: "Bring your CV" })).toMatchObject({ ok: true });
    expect(await change(holder("head-fin"), { capacity: 2 })).toMatchObject({ ok: true });
    expect(sent).toEqual([]);
    expect(slotOf(slotId)).toMatchObject({ capacity: 2 });
  });

  it("tells the interviewer too when someone else changed the slot", async () => {
    expect(await change(reviewer, { location: "https://meet.example/c" })).toMatchObject({
      ok: true,
    });
    expect(sent.map((m) => [m.key, m.to])).toEqual([
      [`interview:${recruitmentId}_ari:changed:2`, "ari@x.org"],
      [`interview:${slotId}:changed:2`, "head-fin@x.org"],
    ]);
  });

  it("the interviewer cancels it: bookings are dropped, no change is spent, applicants asked to pick again", async () => {
    expect(await interviews().cancelSlot(...as(holder("head-dir")))({ id: slotId })).toMatchObject({
      error: "refused",
    });
    expect(await interviews().cancelSlot(...as(holder("head-fin")))({ id: slotId })).toMatchObject({
      ok: true,
    });
    expect(slotOf(slotId)?.["deletedAt"]).toBeTruthy();
    expect(applicationOf("ari")).toMatchObject({ interviews: {}, interviewChanged: [] });
    expect(sent.map((m) => [m.key, m.to])).toEqual([
      [`interview:${recruitmentId}_ari:cancelled:${slotId}`, "ari@x.org"],
    ]);
    expect(await book("ari", "finance", slotId)).toMatchObject({ ok: false, error: "refused" });
  });
});

describe("reminders 30 minutes before (cron meeting-reminders)", () => {
  it("tells both sides once, inside the last 30 minutes only", async () => {
    await interviews().createMine(...as(holder("head-fin")))(mine("finance"));
    const [a, b] = await slots();
    await inInterview("ari");
    await inInterview("budi");
    await book("ari", "finance", a!.id);
    await book("budi", "finance", b!.id);
    sent.length = 0;
    const remind = createInterviewReminders({
      bookings: (from, to) => createSqlApplicationStore(db()).bookingsBetween(from, to),
      contacts,
      send,
      webUrl: "https://web.example",
      adminUrl: "https://admin.example",
      now: () => clock,
    });
    clock = new Date("2026-11-14T23:00:00Z"); // 60 minutes before the first time
    expect(await remind()).toEqual({ interviewMessages: 0 });
    clock = new Date("2026-11-14T23:40:00Z"); // 20 minutes before; the second is 50 minutes away
    expect(await remind()).toEqual({ interviewMessages: 2 });
    const start = a!.startsAt.getTime();
    expect(sent.map((m) => m.key).sort()).toEqual(
      [
        `interview:${recruitmentId}_ari:start:ari:${start}`,
        `interview:${recruitmentId}_ari:start:head-fin:${start}`,
      ].sort(),
    );
    expect(sent.find((m) => m.to === "ari@x.org")!.text).toContain("07:00");
    expect(await remind()).toEqual({ interviewMessages: 0 });
  });
});

describe("reminder texts", () => {
  it("give the address of an on-site time, escape HTML, fall back to the time's zone and skip inactive accounts", async () => {
    const mails: unknown[] = [];
    const remind = createInterviewReminders({
      bookings: () =>
        Promise.resolve([
          {
            application: { id: "r_ari", userId: "ari", recruitmentId: "r" },
            slot: {
              startsAt: new Date("2026-11-15T00:00:00Z"),
              timeZone: "Asia/Tokyo",
              interviewerUid: "gone",
              mode: "onsite",
              location: "Gedung <A> & B",
              note: "",
            },
          },
        ] as never),
      contacts: () =>
        Promise.resolve(new Map([["gone", { email: "g@x.org", phone: null, active: false }]])),
      send: (message) => (mails.push(message), Promise.resolve("sent" as const)),
      webUrl: "https://web.example",
      adminUrl: "https://admin.example",
      now: () => clock,
    });
    expect(await remind()).toEqual({ interviewMessages: 1 });
    expect(mails).toEqual([
      expect.objectContaining({
        to: null,
        text: expect.stringContaining("09:00") as string,
        html: expect.stringContaining("Alamat / Address: Gedung &#60;A&#62; &#38; B") as string,
      }),
    ]);
  });
});

describe("assessments (11.6): rubric, one per interviewer, visibility, locks", () => {
  const scoresFor = (...v: number[]) =>
    Object.fromEntries(DEFAULT_RUBRIC.map((a, i) => [a.key, v[i]!]));
  const assess = (principal: Principal, patch: Record<string, unknown> = {}) =>
    interviews().saveAssessment(...as(principal))({
      id: `${recruitmentId}_ari`,
      choiceId: "finance",
      scores: scoresFor(3, 3, 3, 3, 3),
      recommendation: "recommended",
      note: "",
      relation: "no close relation",
      ...patch,
    });
  const mark = (principal: Principal, attendance: "attended" | "absent") =>
    interviews().markAttendance(...as(principal))({
      id: `${recruitmentId}_ari`,
      choiceId: "finance",
      attendance,
      note: "",
      version: applicationOf("ari")?.["version"] as number,
    });
  const stored = () =>
    [...fake.docs.keys()].filter((k) => k.startsWith("interviewAssessments/")).length;
  const listed = (uid: string, review: boolean) =>
    createInterviewReads({
      applications: createSqlApplicationStore(db()),
      interviews: createSqlInterviewStore(db()),
      scope: scopeOf,
    }).assessments(uid, recruitmentId, review);

  beforeEach(async () => {
    await interviews().createMine(...as(holder("head-fin")))(mine("finance"));
    await inInterview("ari");
    await book("ari", "finance", (await slots())[0]!.id);
  });

  it("two interviewers assess one applicant: 3.2 (2), and saving marks the interview attended", async () => {
    expect(await assess(holder("head-fin"))).toMatchObject({ ok: true });
    expect(
      await assess(holder("head-dir"), { scores: scoresFor(4, 3, 3, 3, 4), note: "very strong" }),
    ).toMatchObject({ ok: true });
    const booking = (applicationOf("ari")?.["interviews"] as Record<string, unknown>)["finance"];
    expect(booking).toMatchObject({ attendance: "attended" });
    expect(assessmentSummary(await listed("head-fin", false))).toMatchObject({
      average: 3.2,
      count: 2,
    });
  });

  it("saves even when the recruitment lost its title", async () => {
    const row = fake.docs.get(`recruitments/${recruitmentId}`) as Record<string, unknown>;
    fake.docs.set(`recruitments/${recruitmentId}`, { ...row, title: undefined });
    expect(await assess(holder("head-fin"))).toMatchObject({ ok: true });
  });

  it("is one per interviewer per interview; the owner updates it", async () => {
    await assess(holder("head-fin"));
    await assess(holder("head-fin"), { scores: scoresFor(2, 2, 2, 2, 2) });
    expect(stored()).toBe(1);
    expect(assessmentSummary(await listed("head-fin", false))).toMatchObject({
      average: 2,
      count: 1,
    });
  });

  it("refuses a missing note, a stranger, a booking that does not exist, and a missing grant", async () => {
    expect(await assess(holder("head-fin"), { recommendation: "not_recommended" })).toMatchObject({
      error: "refused",
    });
    expect(await assess(holder("member-fin"))).toMatchObject({ error: "forbidden" });
    expect(await assess(holder("head-fin"), { choiceId: "media" })).toMatchObject({
      error: "refused",
    });
    expect(await assess(holder("granted-media"))).toMatchObject({
      issues: ["This applicant is not in your scope."],
    });
    expect(await assess(holder("head-fin"), { id: `${recruitmentId}_nobody` })).toMatchObject({
      issues: ["This application does not exist."],
    });
    expect(await interviews().cancelSlot(...as(reviewer))({ id: "missing" })).toMatchObject({
      issues: ["This interview time does not exist."],
    });
    expect(await assess(staff(["recruitment.offer"], "offer-1"))).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(stored()).toBe(0);
  });

  it("shows another interviewer's assessment only after you sent yours; the committee sees all", async () => {
    await assess(holder("head-fin"));
    expect(await listed("head-dir", false)).toEqual([]);
    expect(await listed("committee-1", true)).toHaveLength(1);
    await assess(holder("head-dir"));
    expect(await listed("head-dir", false)).toHaveLength(2);
  });

  it("an assessed interview cannot be marked absent; a cancelled booking cannot be assessed", async () => {
    await assess(holder("head-fin"));
    expect(await mark(reviewer, "absent")).toMatchObject({ error: "refused" });
    expect(await mark(reviewer, "attended")).toMatchObject({ ok: true });
    const bookings = applicationOf("ari")?.["interviews"] as Record<string, { slotId: string }>;
    await interviews().cancelSlot(...as(holder("head-fin")))({ id: bookings["finance"]!.slotId });
    expect(await assess(holder("head-fin"))).toMatchObject({ error: "refused" });
  });

  it("keeps the rubric it was scored with when the committee changes the rubric", async () => {
    await assess(holder("head-fin"));
    const actions = createRecruitmentActions({
      send: () => Promise.resolve("logged" as const),
      recruitments: createSqlRecruitmentStore(db()),
      now: () => clock,
    });
    const [first] = DEFAULT_RUBRIC;
    const versionOf = () => fake.docs.get(`recruitments/${recruitmentId}`)?.["version"] as number;
    expect(
      await actions.saveRubric(...as(staff(["recruitment.edit"])))({
        id: recruitmentId,
        version: versionOf(),
        rubric: [{ ...first!, weight: 5 }],
      }),
    ).toMatchObject({ ok: true });
    expect(fake.docs.get(`recruitments/${recruitmentId}`)?.["interviewRubric"]).toHaveLength(1);
    const [kept] = await listed("committee-1", true);
    expect(kept!.rubric).toHaveLength(5);
    await assess(holder("head-dir"), { scores: { [first!.key]: 4 }, note: "n" });
    const all = await listed("committee-1", true);
    expect(all.find((a) => a.uid === "head-dir")!.rubric).toHaveLength(1);
    await actions.saveRubric(...as(staff(["recruitment.edit"])))({
      id: recruitmentId,
      version: versionOf(),
      rubric: DEFAULT_RUBRIC,
    });
    expect(fake.docs.get(`recruitments/${recruitmentId}`)?.["interviewRubric"]).toBeUndefined();
  });
});

describe("the stores on their own: older rows and missing records", () => {
  const apps = () => createSqlApplicationStore(db());
  const times = () => createSqlInterviewStore(db());
  let audits = 0;
  const audit = (() => ({ id: `audit-${++audits}` })) as never;
  const appPath = (uid: string) => `applications/${recruitmentId}_${uid}`;

  beforeEach(async () => {
    await interviews().createPlan(...as(reviewer))({ recruitmentId, plan });
    await inInterview("ari");
  });

  it("reads a booking from before step 11.5 as the first choice, and slots without a mode", async () => {
    const row = fake.docs.get(appPath("ari")) as Record<string, unknown>;
    const legacy = { slotId: "old", startsAt: clock, attendance: null, attendanceNote: null };
    fake.docs.set(appPath("ari"), { ...row, interviews: undefined, interview: legacy });
    expect((await apps().get(`${recruitmentId}_ari`))?.interviews).toEqual({ finance: legacy });
    fake.docs.set(appPath("ari"), { ...row, interviews: undefined, interview: null });
    expect((await apps().get(`${recruitmentId}_ari`))?.interviews).toEqual({});
    const [a, b] = await slots();
    const slot = (id: string, location: string) =>
      fake.docs.set(`interviewSlots/${id}`, { ...slotOf(id), mode: undefined, location });
    slot(a!.id, "");
    slot(b!.id, "Gedung A, Tokyo");
    expect((await times().get(a!.id))?.mode).toBe("online");
    expect((await times().get(b!.id))?.mode).toBe("onsite");
    expect(await times().get("../bad")).toBeNull();
    expect(await times().get("missing")).toBeNull();
  });

  it("refuses missing or deleted times and applications; an unchanged time saves nothing", async () => {
    const [a] = await slots();
    expect(await times().update(a!.id, { startsAt: a!.startsAt }, audit)).toMatchObject({
      changed: false,
    });
    expect(await times().cancel(a!.id, audit, clock)).toMatchObject({ applications: [] });
    await expect(times().update(a!.id, {}, audit)).rejects.toThrow("does not exist");
    await expect(times().update("missing", {}, audit)).rejects.toThrow("does not exist");
    await expect(times().cancel("missing", audit, clock)).rejects.toThrow("does not exist");
    const input = {
      id: `${recruitmentId}_nobody`,
      choiceId: "finance",
      scores: {},
      recommendation: "recommended",
      note: "",
      relation: "",
    } as never;
    await expect(apps().saveAssessment(input, "u", audit, clock)).rejects.toThrow("does not exist");
    const mark = { attendance: "attended" as const, note: "", version: 1 };
    const by = { uid: "u", review: true };
    await expect(
      apps().markAttendance(`${recruitmentId}_nobody`, "finance", mark, by, audit, clock),
    ).rejects.toThrow("does not exist");
  });

  it("marks attendance against the current version, even when the recruitment lost its title", async () => {
    const [a] = await slots();
    await book("ari", "finance", a!.id);
    const id = `${recruitmentId}_ari`;
    const by = { uid: "u", review: true };
    const mark = (version: number) => ({ attendance: "attended" as const, note: "", version });
    await expect(apps().markAttendance(id, "finance", mark(0), by, audit, clock)).rejects.toThrow(
      "version changed",
    );
    const row = fake.docs.get(`recruitments/${recruitmentId}`) as Record<string, unknown>;
    fake.docs.set(`recruitments/${recruitmentId}`, { ...row, title: undefined });
    const titles: string[] = [];
    const log = ((...args: unknown[]) => (
      titles.push(args[4] as string),
      { id: "audit-t" }
    )) as never;
    const version = applicationOf("ari")?.["version"] as number;
    await apps().markAttendance(id, "finance", mark(version), by, log, clock);
    expect(titles).toEqual([""]);
  });

  it("a core unit opens its one seat, whatever seats were asked for", async () => {
    fake.docs.set("orgUnits/treasury", {
      periodId: "p2026",
      name: "Bendahara",
      type: "bendahara",
      path: [],
      deletedAt: null,
    });
    const saved = await createRecruitmentActions({
      send: () => Promise.resolve("logged" as const),
      recruitments: createSqlRecruitmentStore(db()),
      now: () => clock,
    }).save(...as(staff(["recruitment.edit"])))({
      periodId: "p2026",
      title: "Bendahara",
      description: "",
      opensAt: "2026-11-01T00:00:00.000Z",
      closesAt: "2026-11-20T00:00:00.000Z",
      maxChoices: 1,
      offerDays: 3,
      formId: "form1",
      units: [{ orgUnitId: "treasury", quota: 1, portfolioRequired: false, seats: ["member"] }],
      version: null,
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    expect(fake.docs.get(`recruitments/${saved.data.id}`)?.["units"]).toMatchObject([
      { orgUnitId: "treasury", seats: ["head"] },
    ]);
  });

  it("lists unit paths, books under a unit without a path and cancels a booking whose time is gone", async () => {
    fake.docs.set("orgUnits/bare", { periodId: "p2026", name: "Bare" });
    expect(await web().unitPaths(["finance", "bare", "ghost", "finance"])).toEqual(
      new Map([
        ["finance", ["dir"]],
        ["bare", []],
      ]),
    );
    const [a] = await slots();
    const unit = fake.docs.get("orgUnits/finance") as Record<string, unknown>;
    fake.docs.set("orgUnits/finance", { ...unit, path: undefined });
    expect(await book("ari", "finance", a!.id)).toMatchObject({ ok: true });
    fake.docs.delete(`interviewSlots/${a!.id}`);
    expect(await web().cancelInterview(recruitmentId, "ari", "finance", clock)).toMatchObject({
      ok: true,
    });
    expect(await web().cancelInterview("missing", "ari", "finance", clock)).toEqual({
      ok: false,
      error: "closed",
    });
    expect(await web().cancelInterview(recruitmentId, "nobody", "finance", clock)).toEqual({
      ok: false,
      error: "locked",
    });
  });
});
