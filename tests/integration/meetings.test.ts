import { beforeEach, describe, expect, it } from "vitest";
import { createSqlMeetingStore, createSqlMessageLog, deleteExpired } from "@website/db/sql";
import {
  attendanceCode,
  CODE_ALPHABET,
  attendanceState,
  dueReminder,
  meetingStatus,
  presentUids,
  type Meeting,
  normalizeCode,
  setRoom,
} from "@website/domain/meetings";
import { createMessenger } from "@website/domain/messaging";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createMeetingActions } from "../../apps/admin/src/server/meetings";
import { createAttend, createAttendCard } from "../../apps/web/src/server/attendance";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMeetingStore>[0];
let clock = new Date("2026-11-10T01:00:00Z");
const staff = (
  userId: string,
  permissions: string[],
  scope: Scope = { type: "global" },
): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const planner = staff("planner", ["meetings.edit"]);
const unitPlanner = staff("unit", ["meetings.edit"], { type: "orgUnit", orgUnitId: "media" });
const chair = staff("chair", ["meetings.read"], { type: "orgUnit", orgUnitId: "other" });
const member = staff("member", ["meetings.read"], { type: "orgUnit", orgUnitId: "other" });

const people: Record<string, string> = {
  "chair@example.org": "chair",
  "member@example.org": "member",
  "sec@example.org": "sec",
  "gone@example.org": "gone",
};

let fake: ReturnType<typeof fakeDb>;
let sent: string[];
let bodies: Record<string, string>;
let seed = 0;
let currentMeeting = "";
const db = () => fake.db as unknown as Db;
const store = () => createSqlMeetingStore(db());
const actions = () =>
  createMeetingActions({
    meetings: store(),
    unitPath: (id) => Promise.resolve(id === "media" ? ["dirs", "media"] : null),
    unitName: (id) => Promise.resolve(id === "media" ? "Media team" : null),
    findUserId: (email) => Promise.resolve(people[email] ?? null),
    contacts: (uids) =>
      Promise.resolve(
        new Map(
          uids
            .filter((uid) => uid !== "member")
            .map((uid) => [
              uid,
              {
                email: `${uid}@example.org`,
                phone: null,
                active: uid !== "gone",
                timeZone: uid === "sec" ? "America/New_York" : null,
              },
            ]),
        ),
      ),
    send: async (message, key) => {
      const result = await createMessenger({
        log: createSqlMessageLog(db()),
        channels: {},
        mode: "log",
        appEnv: "test",
        testRecipients: [],
        now: () => clock,
      }).send(message, key);
      if (result !== "duplicate") {
        sent.push(key);
        bodies[key] = message.text;
      }
      return result;
    },
    adminUrl: "https://admin.example.org",
    webUrl: "https://example.org",
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i * 7 + (seed += 1)),
    zoomBooking: (id) =>
      Promise.resolve(
        id === "z-ok"
          ? {
              status: "approved",
              meetingId: currentMeeting,
              passcode: "pw123",
              joinUrl: "https://zoom.example/j/1",
              shortUrl: null,
            }
          : id === "z-other"
            ? { status: "approved", meetingId: "elsewhere" }
            : null,
      ),
    now: () => clock,
    uuid: () => "u1",
  });

const zoneOf = (uid: string) => Promise.resolve(uid === "sec" ? "America/New_York" : null);

const input = {
  title: "Rapat kerja",
  description: "",
  orgUnitId: "media",
  startsAtLocal: "2026-11-10T19:00",
  timeZone: "Asia/Tokyo",
  durationMinutes: 90,
  agenda: ["Opening", "Budget"],
  participants: [
    { email: "chair@example.org", role: "chair" },
    { email: "member@example.org", role: "member" },
  ],
};
async function create(extra: Record<string, unknown> = {}, who = planner) {
  const result = await actions().save(...as(who))({
    ...input,
    periodId: "p1",
    version: null,
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data;
}

beforeEach(() => {
  fake = fakeDb();
  sent = [];
  bodies = {};
  clock = new Date("2026-11-10T01:00:00Z");
});

describe("meeting rules (F4)", () => {
  it("room is a Zoom booking XOR an external link: saving one clears the other", () => {
    expect(setRoom({ kind: "zoom", zoomRequestId: "z1" })).toEqual({
      zoomRequestId: "z1",
      externalUrl: null,
    });
    expect(setRoom({ kind: "link", url: "https://meet.example.org/x" })).toEqual({
      zoomRequestId: null,
      externalUrl: "https://meet.example.org/x",
    });
    expect(setRoom({ kind: "none" })).toEqual({ zoomRequestId: null, externalUrl: null });
  });

  it("codes use the unambiguous alphabet, and typing is forgiving", () => {
    const code = attendanceCode(Uint8Array.from([0, 1, 2, 30, 31, 255, 9]));
    expect(code).toHaveLength(6);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(normalizeCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBe(code);
    expect(normalizeCode("O0I1LX")).toBeNull();
    expect(normalizeCode("ABC")).toBeNull();
    expect(() => attendanceCode(new Uint8Array(3))).toThrow();
  });

  it("status is read-time; reminders fall in their windows only", () => {
    const m = {
      startsAt: new Date("2026-11-10T10:00:00Z"),
      endsAt: new Date("2026-11-10T11:00:00Z"),
      cancelledAt: null,
    };
    expect(meetingStatus(m, new Date("2026-11-10T10:59:00Z"))).toBe("scheduled");
    expect(meetingStatus(m, new Date("2026-11-10T11:00:00Z"))).toBe("finished");
    expect(meetingStatus({ ...m, cancelledAt: new Date() }, new Date(0))).toBe("cancelled");
    expect(dueReminder(m, new Date("2026-11-10T09:44:00Z"))).toBeNull();
    expect(dueReminder(m, new Date("2026-11-10T09:45:00Z"))).toBe("start");
    expect(dueReminder(m, new Date("2026-11-10T10:00:00Z"))).toBeNull();
    expect(dueReminder(m, new Date("2026-11-10T11:30:00Z"))).toBe("end");
    expect(dueReminder(m, new Date("2026-11-10T12:00:00Z"))).toBeNull();
    expect(
      dueReminder({ ...m, cancelledAt: new Date() }, new Date("2026-11-10T09:50:00Z")),
    ).toBeNull();
  });
});

describe("meetings (F4)", () => {
  it("are scheduled in the chosen zone with exactly one chair, in the planner's scope", async () => {
    const m = await create({}, unitPlanner);
    const saved = await store().get(m.id);
    expect(saved?.startsAt.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(saved?.endsAt.toISOString()).toBe("2026-11-10T11:30:00.000Z");
    expect(saved?.orgUnitPath).toEqual(["dirs", "media"]);
    expect(saved?.participantIds).toEqual(["chair", "member"]);

    const noChair = await actions().save(...as(planner))({
      ...input,
      periodId: "p1",
      version: null,
      participants: [{ email: "member@example.org", role: "member" }],
    });
    expect(noChair).toMatchObject({ ok: false, issues: ["Name exactly one chair."] });
    const unknown = await actions().save(...as(planner))({
      ...input,
      periodId: "p1",
      version: null,
      participants: [{ email: "who@example.org", role: "chair" }],
    });
    expect(unknown).toMatchObject({ ok: false, error: "refused" });
    const region = await actions().save(...as(unitPlanner))({
      ...input,
      orgUnitId: null,
      periodId: "p1",
      version: null,
    });
    expect(region).toMatchObject({ ok: false, error: "forbidden" });
    const past = await actions().save(...as(planner))({
      ...input,
      startsAtLocal: "2026-11-09T19:00",
      periodId: "p1",
      version: null,
    });
    expect(past).toMatchObject({ ok: false, issues: ["The start time has passed."] });
  });

  it("authority comes from the role in the meeting", async () => {
    const m = await create();
    const room = { kind: "link", url: "https://meet.example.org/abc" };
    const byMember = await actions().saveRoom(...as(member))({ ...m, room });
    expect(byMember).toMatchObject({ ok: false, error: "refused" });
    const byChair = await actions().saveRoom(...as(chair))({ ...m, room });
    expect(byChair.ok).toBe(true);
    expect((await store().get(m.id))?.room).toEqual({
      zoomRequestId: null,
      externalUrl: "https://meet.example.org/abc",
    });
    currentMeeting = m.id;
    const zoomed = await actions().saveRoom(...as(chair))({
      id: m.id,
      version: byChair.ok ? byChair.data.version : 0,
      room: { kind: "zoom", zoomRequestId: "z-ok" },
    });
    expect(zoomed.ok).toBe(true);
    expect((await store().get(m.id))?.room).toEqual({ zoomRequestId: "z-ok", externalUrl: null });
    const foreign = await actions().saveRoom(...as(chair))({
      id: m.id,
      version: 3,
      room: { kind: "zoom", zoomRequestId: "z-other" },
    });
    expect(foreign).toMatchObject({
      issues: ["Choose an approved Zoom booking made for this meeting."],
    });
    const code = await actions().openCode(...as(member))({ id: m.id });
    expect(code).toMatchObject({ ok: false, error: "refused" });
  });

  it("attendance by a rotating hashed code; only participants, only while open", async () => {
    const m = await create();
    const opened = await actions().openCode(...as(chair))({ id: m.id });
    if (!opened.ok) throw new Error("no code");
    const { code } = opened.data;
    expect(opened.data.url).toBe(`https://example.org/attend/${code}`);
    expect([...fake.docs.keys()].some((k) => k.includes(code))).toBe(false);

    const attend = createAttend({ meetings: store(), zoneOf, now: () => clock });
    expect(await attend(null, code)).toEqual({ ok: false, error: "signin" });
    expect(await attend("member", code)).toEqual({ ok: false, error: "closed" });
    clock = new Date("2026-11-10T09:31:00Z");
    expect(await attend("member", code)).toEqual({ ok: false, error: "invalid" });
    const fresh = await actions().openCode(...as(chair))({ id: m.id });
    if (!fresh.ok) throw new Error("no code");
    expect(await attend("stranger", fresh.data.code)).toEqual({
      ok: false,
      error: "not_participant",
    });
    expect(await attend("member", fresh.data.code.toLowerCase())).toEqual({
      ok: true,
      title: "Rapat kerja",
      at: clock.toISOString(),
      zone: "Asia/Tokyo",
    });
    const once = (await store().get(m.id))?.attendance["member"];
    clock = new Date("2026-11-10T09:32:00Z");
    expect(await attend("member", fresh.data.code)).toMatchObject({ ok: true });
    expect((await store().get(m.id))?.attendance["member"]).toEqual(once);
    expect(await attend("member", "ZZZZZZ")).toEqual({ ok: false, error: "invalid" });
    expect(await attend("member", "bad")).toEqual({ ok: false, error: "invalid" });
    expect((await store().get(m.id))?.version).toBe(m.version);

    clock = new Date("2026-11-10T10:00:00Z");
    const removed = await deleteExpired(db(), clock);
    expect(removed.attendanceCodes).toBe(2);
  });

  it("the chair ticks someone present once started; a cancelled meeting is history", async () => {
    const m = await create();
    const early = await actions().mark(...as(chair))({
      ...m,
      uids: ["member"],
      status: "present",
    });
    expect(early).toMatchObject({ ok: false, error: "refused" });
    clock = new Date("2026-11-10T10:05:00Z");
    const ticked = await actions().mark(...as(chair))({
      ...m,
      uids: ["member"],
      status: "present",
    });
    if (!ticked.ok) throw new Error("tick failed");
    expect((await store().get(m.id))?.attendance["member"]?.method).toBe("manual");
    const untick = await actions().mark(...as(chair))({
      id: m.id,
      version: ticked.data.version,
      uids: ["member"],
      status: "none",
    });
    if (!untick.ok) throw new Error("untick failed");
    expect((await store().get(m.id))?.attendance).toEqual({});
    const cancelled = await actions().cancel(...as(chair))({
      id: m.id,
      version: untick.data.version,
      reason: "Moved",
    });
    expect(cancelled.ok).toBe(true);
    const again = await actions().cancel(...as(chair))({
      id: m.id,
      version: untick.data.version + 1,
      reason: "Again",
    });
    expect(again).toMatchObject({ ok: false, issues: ["This meeting is cancelled."] });
    expect(await actions().openCode(...as(chair))({ id: m.id })).toMatchObject({ ok: false });
  });

  it("reminders go out once per person, however often the cron job runs", async () => {
    const m = await create();
    sent.length = 0;
    clock = new Date("2026-11-10T09:50:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 2 });
    clock = new Date("2026-11-10T09:55:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 0 });
    clock = new Date("2026-11-10T11:31:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 2 });
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 0 });
    expect(sent).toEqual([
      `meeting:${m.id}:start:chair:${start}`,
      `meeting:${m.id}:start:member:${start}`,
      `meeting:${m.id}:end:chair`,
      `meeting:${m.id}:end:member`,
    ]);
    clock = new Date("2026-11-10T15:00:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 0, messages: 0 });
  });
});

const start = new Date("2026-11-10T10:00:00Z").getTime();

describe("meeting edits and lists (F4)", () => {
  it("two agenda items with the same title keep two ids", async () => {
    const m = await create({}, unitPlanner);
    const before = await store().get(m.id);
    const saved = await actions().save(...as(unitPlanner))({
      ...input,
      id: m.id,
      version: m.version,
      periodId: "p1",
      agenda: ["Report", "Budget", "Budget"],
      participants: [
        { email: "chair@example.org", role: "chair" },
        { email: "sec@example.org", role: "secretary" },
      ],
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const ids = (await store().get(m.id))?.agenda.map((a) => a.id) ?? [];
    expect(ids[1]).toBe(before?.agenda[1]?.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("edits keep agenda ids of unchanged items and stay inside the editor's units", async () => {
    const m = await create({}, unitPlanner);
    const before = await store().get(m.id);
    const edited = await actions().save(...as(unitPlanner))({
      ...input,
      id: m.id,
      version: m.version,
      periodId: "p1",
      agenda: ["Budget", "Closing"],
      participants: [
        { email: "chair@example.org", role: "chair" },
        { email: "sec@example.org", role: "secretary" },
      ],
    });
    if (!edited.ok) throw new Error(JSON.stringify(edited));
    const after = await store().get(m.id);
    expect(after?.agenda[0]?.id).toBe(before?.agenda[1]?.id);
    expect(after?.agenda[1]?.title).toBe("Closing");
    expect(after?.participantIds).toEqual(["chair", "sec"]);

    const moved = await actions().save(...as(unitPlanner))({
      ...input,
      id: m.id,
      version: edited.data.version,
      periodId: "p1",
      orgUnitId: null,
    });
    expect(moved).toMatchObject({
      ok: false,
      issues: ["You can only schedule meetings of your own unit."],
    });
    const ghost = await actions().save(...as(planner))({
      ...input,
      id: "ghost",
      version: 1,
      periodId: "p1",
    });
    expect(ghost).toMatchObject({ ok: false, error: "forbidden" });

    clock = new Date("2026-11-10T12:00:00Z");
    const late = await actions().save(...as(planner))({
      ...input,
      id: m.id,
      version: edited.data.version,
      periodId: "p1",
    });
    expect(late).toMatchObject({ ok: false, issues: ["This meeting is finished."] });
  });

  it("participants: one chair, one secretary at most, nobody twice", async () => {
    const save = (participants: Array<{ email: string; role: string }>) =>
      actions().save(...as(planner))({ ...input, periodId: "p1", version: null, participants });
    expect(
      await save([
        { email: "chair@example.org", role: "chair" },
        { email: "chair@example.org", role: "member" },
      ]),
    ).toMatchObject({ issues: ["A person is listed twice."] });
    expect(
      await save([
        { email: "chair@example.org", role: "chair" },
        { email: "member@example.org", role: "secretary" },
        { email: "sec@example.org", role: "secretary" },
      ]),
    ).toMatchObject({ issues: ["Name at most one secretary."] });
    const many = Array.from({ length: 301 }, (_, i) => ({
      email: `p${i}@example.org`,
      role: "member",
    }));
    expect(await save(many)).toMatchObject({ error: "invalid_input" });
    expect(
      await actions().save(...as(planner))({
        ...input,
        timeZone: "Mars/Base",
        periodId: "p1",
        version: null,
      }),
    ).toMatchObject({ error: "invalid_input", fields: { timeZone: "Choose a time zone." } });
  });

  it("lists per period, per participant and per time range; who may see one", async () => {
    const a = await create();
    await create({
      title: "Later",
      startsAtLocal: "2026-11-12T19:00",
      participants: [{ email: "sec@example.org", role: "chair" }],
    });
    await create({
      title: "Latest",
      startsAtLocal: "2026-11-13T19:00",
      participants: [{ email: "sec@example.org", role: "chair" }],
    });
    fake.docs.set("meetings/gone", { ...fake.docs.get(`meetings/${a.id}`), deletedAt: new Date() });
    expect((await store().listForPeriod("p1")).map((m) => m.title)).toEqual([
      "Rapat kerja",
      "Later",
      "Latest",
    ]);
    expect((await store().listForUser("sec")).map((m) => m.title)).toEqual(["Latest", "Later"]);
    expect(
      (
        await store().listBetween(
          new Date("2026-11-10T00:00:00Z"),
          new Date("2026-11-11T00:00:00Z"),
        )
      ).map((m) => m.id),
    ).toEqual([a.id]);
    const meeting = await store().get(a.id);
    if (!meeting) throw new Error("missing");
    const { canSeeMeeting } = await import("../../apps/admin/src/server/meetings");
    expect(canSeeMeeting(member, meeting)).toBe(true);
    expect(canSeeMeeting(staff("x", ["meetings.read"]), meeting)).toBe(true);
    expect(canSeeMeeting(staff("y", ["events.read"]), meeting)).toBe(false);
    expect(await store().get("bad id")).toBeNull();
  });

  it("a manual tick also refuses strangers and cancelled meetings", async () => {
    const m = await create();
    clock = new Date("2026-11-10T10:05:00Z");
    const stranger = await actions().mark(...as(chair))({
      ...m,
      uids: ["nobody"],
      status: "present",
    });
    expect(stranger).toMatchObject({ issues: ["You are not a participant of this meeting."] });
    fake.docs.set(`meetings/${m.id}`, { ...fake.docs.get(`meetings/${m.id}`), cancelledAt: clock });
    const attend = createAttend({ meetings: store(), zoneOf, now: () => clock });
    const opened = await actions().openCode(...as(planner))({ id: "missing" });
    expect(opened).toMatchObject({ ok: false, issues: ["This meeting does not exist."] });
    await store().saveCode("ABCDEF", m.id, new Date("2026-11-10T11:00:00Z"));
    expect(await attend("member", "ABCDEF")).toEqual({ ok: false, error: "closed" });
    await store().saveCode("ABCDEG", "missing", new Date("2026-11-10T11:00:00Z"));
    expect(await attend("member", "ABCDEG")).toEqual({ ok: false, error: "closed" });
    fake.docs.set("meetings/trash", { ...fake.docs.get(`meetings/${m.id}`), deletedAt: clock });
    await store().saveCode("ABCDEH", "trash", new Date("2026-11-10T11:00:00Z"));
    expect(await attend("member", "ABCDEH")).toEqual({ ok: false, error: "closed" });
    const broken = createAttend({
      meetings: {
        findCode: () => Promise.resolve("m"),
        attend: () => Promise.reject(new Error("database down")),
      },
      zoneOf,
      now: () => clock,
    });
    await expect(broken("member", "ABCDEF")).rejects.toThrow("database down");
    expect(
      await actions().save(...as(planner))({
        ...input,
        orgUnitId: "nowhere",
        periodId: "p1",
        version: null,
      }),
    ).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("a cancelled meeting gets no reminders", async () => {
    const m = await create();
    await actions().cancel(...as(chair))({ ...m, reason: "Moved" });
    clock = new Date("2026-11-10T09:50:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 0 });
  });
});

describe("meeting notices (12.1)", () => {
  const edit = (
    m: { id: string; version: number },
    extra: Record<string, unknown> = {},
    who = planner,
  ) =>
    actions().save(...as(who))({
      ...input,
      id: m.id,
      version: m.version,
      periodId: "p1",
      ...extra,
    });

  it("adding a participant sends one invitation, in their zone, with unit, link and agenda", async () => {
    const m = await create({
      participants: [
        { email: "chair@example.org", role: "chair" },
        { email: "member@example.org", role: "member" },
        { email: "gone@example.org", role: "member" },
      ],
    });
    // the inactive account is skipped
    expect(sent).toEqual([`meeting:${m.id}:invite:chair`, `meeting:${m.id}:invite:member`]);

    const edited = await edit(m, {
      agenda: ["A", "B", "C", "D", "E", "F"],
      participants: [
        { email: "chair@example.org", role: "chair" },
        { email: "member@example.org", role: "member" },
        { email: "sec@example.org", role: "secretary" },
      ],
    });
    if (!edited.ok) throw new Error(JSON.stringify(edited));
    expect(sent.slice(2)).toEqual([`meeting:${m.id}:invite:sec`]);
    const body = bodies[`meeting:${m.id}:invite:sec`] ?? "";
    expect(body).toContain("Rapat kerja");
    expect(body).toContain("05:00"); // 10:00 UTC in New York
    expect(body).toContain("Media team");
    expect(body).toContain("5. E");
    expect(body).not.toContain("6. F");
    expect(body).toContain(`https://admin.example.org/meetings/${m.id}`);
  });

  it("the saver is not told about their own change; a meeting that has started invites nobody", async () => {
    const withSec = [
      { email: "chair@example.org", role: "chair" },
      { email: "sec@example.org", role: "secretary" },
    ];
    const m = await create({ participants: withSec });
    sent.length = 0;
    const own = await edit(
      m,
      { startsAtLocal: "2026-11-10T20:00", participants: withSec },
      staff("sec", ["meetings.edit"]),
    );
    if (!own.ok) throw new Error(JSON.stringify(own));
    expect(sent).toEqual([`meeting:${m.id}:change:chair:${own.data.version}`]);

    sent.length = 0;
    clock = new Date("2026-11-10T11:30:00Z"); // 20:00 Tokyo = 11:00Z has started
    const late = await edit(own.data, {
      startsAtLocal: "2026-11-10T20:00",
      participants: [...withSec, { email: "member@example.org", role: "member" }],
    });
    expect(late.ok).toBe(true);
    expect(sent).toEqual([]);
  });

  it("a change goes out only when start, end, link or passcode changed, once per version", async () => {
    const m = await create();
    sent.length = 0;
    // nothing changed, or only the zone label: nothing is sent
    expect((await edit(m)).ok).toBe(true);
    const relabelled = await edit(
      { id: m.id, version: m.version + 1 },
      { timeZone: "Asia/Seoul", startsAtLocal: "2026-11-10T19:00" },
    );
    expect(relabelled.ok).toBe(true);
    expect(sent).toEqual([]);

    const v = m.version + 2;
    const moved = await edit({ id: m.id, version: v }, { startsAtLocal: "2026-11-10T20:00" });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    expect(sent).toEqual([
      `meeting:${m.id}:change:chair:${moved.data.version}`,
      `meeting:${m.id}:change:member:${moved.data.version}`,
    ]);
    expect(bodies[`meeting:${m.id}:change:chair:${moved.data.version}`]).toMatch(/→/);

    sent.length = 0;
    const quiet = await edit(
      { id: m.id, version: moved.data.version },
      { startsAtLocal: "2026-11-10T21:00", notify: false },
    );
    expect(quiet.ok).toBe(true);
    expect(sent).toEqual([]);
  });

  it("a room change tells about the new link and passcode", async () => {
    const m = await create();
    currentMeeting = m.id;
    sent.length = 0;
    const room = await actions().saveRoom(...as(planner))({
      id: m.id,
      version: m.version,
      room: { kind: "zoom", zoomRequestId: "z-ok" },
    });
    if (!room.ok) throw new Error(JSON.stringify(room));
    expect(sent).toHaveLength(2);
    const body = bodies[`meeting:${m.id}:change:chair:${room.data.version}`] ?? "";
    expect(body).toContain("https://zoom.example/j/1");
    expect(body).toContain("pw123");
    sent.length = 0;
    const quiet = await actions().saveRoom(...as(planner))({
      id: m.id,
      version: room.data.version,
      notify: false,
      room: { kind: "link", url: "https://meet.example.org/q" },
    });
    if (!quiet.ok) throw new Error(JSON.stringify(quiet));
    expect(sent).toEqual([]);
    const back = await actions().saveRoom(...as(planner))({
      id: m.id,
      version: quiet.data.version,
      room: { kind: "zoom", zoomRequestId: "z-ok" },
    });
    if (!back.ok) throw new Error(JSON.stringify(back));
    const none = await actions().saveRoom(...as(planner))({
      id: m.id,
      version: back.data.version,
      room: { kind: "link", url: "https://meet.example.org/q" },
    });
    if (!none.ok) throw new Error(JSON.stringify(none));
    expect(bodies[`meeting:${m.id}:change:chair:${none.data.version}`]).toContain("pw123");
  });

  it("an invitation without a unit or agenda leaves those lines out", async () => {
    const m = await create({ orgUnitId: null, agenda: [] });
    const body = bodies[`meeting:${m.id}:invite:member`] ?? "";
    expect(body).toContain("Rapat kerja");
    expect(body).not.toContain("Unit:");
    expect(body).not.toContain("Agenda:");
  });

  it("cancelling tells everyone once, unless switched off", async () => {
    const m = await create();
    sent.length = 0;
    const cancelled = await actions().cancel(...as(planner))({ ...m, reason: "Moved" });
    expect(cancelled.ok).toBe(true);
    expect(sent).toEqual([`meeting:${m.id}:cancel:chair`, `meeting:${m.id}:cancel:member`]);
    expect(bodies[`meeting:${m.id}:cancel:chair`]).toContain("Moved");

    const second = await create();
    sent.length = 0;
    await actions().cancel(...as(planner))({ ...second, reason: "Moved", notify: false });
    expect(sent).toEqual([]);
  });

  it("the start reminder carries the link and passcode, asks the chair to open the attendance, and repeats for a moved meeting", async () => {
    const m = await create();
    currentMeeting = m.id;
    const room = await actions().saveRoom(...as(planner))({
      id: m.id,
      version: m.version,
      room: { kind: "zoom", zoomRequestId: "z-ok" },
    });
    if (!room.ok) throw new Error(JSON.stringify(room));
    sent.length = 0;
    clock = new Date("2026-11-10T09:50:00Z");
    await actions().sendReminders();
    const chairBody = bodies[`meeting:${m.id}:start:chair:${start}`] ?? "";
    expect(chairBody).toContain("pw123");
    expect(chairBody).toContain("https://zoom.example/j/1");
    expect(chairBody).toContain("presensi");
    expect(bodies[`meeting:${m.id}:start:member:${start}`]).not.toContain("Open the attendance");

    const moved = await edit(
      { id: m.id, version: room.data.version },
      { startsAtLocal: "2026-11-10T19:30" },
    );
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    sent.length = 0;
    clock = new Date("2026-11-10T10:20:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 2 });
    expect(sent[0]).toBe(`meeting:${m.id}:start:chair:${start + 30 * 60_000}`);
  });
  it("the start reminder skips people marked excused or sick, and only the start reminder", async () => {
    const m = await create();
    clock = new Date("2026-11-10T09:30:00Z");
    const marked = await actions().mark(...as(chair))({
      ...m,
      uids: ["member"],
      status: "sick",
      note: "Flu",
    });
    if (!marked.ok) throw new Error(JSON.stringify(marked));
    sent.length = 0;
    clock = new Date("2026-11-10T09:50:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 1 });
    expect(sent).toEqual([`meeting:${m.id}:start:chair:${start}`]);
    clock = new Date("2026-11-10T11:31:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 2 });
  });

  it("marks several people at once with a state and a note; clearing removes the record", async () => {
    const m = await create();
    clock = new Date("2026-11-10T09:30:00Z");
    const excused = await actions().mark(...as(chair))({
      ...m,
      uids: ["chair", "member"],
      status: "excused",
      note: "Exam",
    });
    if (!excused.ok) throw new Error(JSON.stringify(excused));
    expect((await store().get(m.id))?.attendance).toMatchObject({
      chair: { status: "excused", note: "Exam", method: "manual" },
      member: { status: "excused", note: "Exam", method: "manual" },
    });
    const early = await actions().mark(...as(chair))({
      id: m.id,
      version: excused.data.version,
      uids: ["member"],
      status: "present",
    });
    expect(early).toMatchObject({ ok: false, error: "refused" });
    const nobody = await actions().mark(...as(chair))({
      id: m.id,
      version: excused.data.version,
      uids: ["member", "nobody"],
      status: "sick",
    });
    expect(nobody).toMatchObject({ issues: ["You are not a participant of this meeting."] });
    expect((await store().get(m.id))?.version).toBe(excused.data.version);
    const cleared = await actions().mark(...as(chair))({
      id: m.id,
      version: excused.data.version,
      uids: ["chair", "member"],
      status: "none",
    });
    expect(cleared.ok).toBe(true);
    expect((await store().get(m.id))?.attendance).toEqual({});
  });

  it("the attendance state is computed: no news appears only after the meeting ended", async () => {
    const m = (await store().get((await create()).id)) as Meeting;
    const withSick = {
      ...m,
      attendance: { chair: { at: clock, method: "manual", status: "sick", note: "" } },
    } as Meeting;
    expect(attendanceState(withSick, "chair", clock)).toBe("sick");
    expect(attendanceState(withSick, "member", clock)).toBe("not_yet");
    expect(attendanceState(withSick, "member", new Date("2026-11-10T11:30:00Z"))).toBe("no_news");
    expect(presentUids(withSick)).toEqual([]);
  });

  it("looking a code up shows the card and never records; a dead code shows nothing", async () => {
    const m = await create();
    await store().saveCode("ABCDEF", m.id, new Date("2026-11-10T11:00:00Z"));
    const card = createAttendCard({
      meetings: store(),
      unitName: (id) => Promise.resolve(id === "media" ? "Media team" : null),
      zoneOf,
      now: () => clock,
    });
    clock = new Date("2026-11-10T09:31:00Z");
    expect(await card("sec", "abcdef")).toBeNull();
    expect(await card("member", "abcdef")).toEqual({
      title: "Rapat kerja",
      startsAt: "2026-11-10T10:00:00.000Z",
      zone: "Asia/Tokyo",
      unit: "Media team",
      place: null,
      recordedAt: null,
    });
    expect(await card("member", "ZZZZZZ")).toBeNull();
    expect(await card("member", "not a code")).toBeNull();
    expect((await store().get(m.id))?.attendance).toEqual({});
    const attend = createAttend({ meetings: store(), zoneOf, now: () => clock });
    const done = await attend("member", "abcdef");
    expect(done).toEqual({
      ok: true,
      title: "Rapat kerja",
      at: clock.toISOString(),
      zone: "Asia/Tokyo",
    });
    expect((await card("member", "ABCDEF"))?.recordedAt).toBe(clock.toISOString());
    const row = fake.docs.get(`meetings/${m.id}`) as Record<string, unknown>;
    fake.docs.set(`meetings/${m.id}`, {
      ...row,
      orgUnitId: null,
      room: { zoomRequestId: "z-ok", externalUrl: null },
    });
    expect(await card("member", "ABCDEF")).toMatchObject({ unit: null, place: "Zoom" });
    expect((await store().get(m.id))?.attendance["member"]?.status).toBe("present");
  });

  it("signing with the code turns an excused mark into present", async () => {
    const m = await create();
    clock = new Date("2026-11-10T09:31:00Z");
    await actions().mark(...as(chair))({ ...m, uids: ["member"], status: "excused" });
    await store().saveCode("ABCDEF", m.id, new Date("2026-11-10T11:00:00Z"));
    await createAttend({ meetings: store(), zoneOf, now: () => clock })("member", "ABCDEF");
    expect((await store().get(m.id))?.attendance["member"]).toMatchObject({
      status: "present",
      method: "code",
    });
  });
});
