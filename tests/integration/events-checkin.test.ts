import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import {
  createSqlCommitteeStore,
  createSqlEventStore,
  createSqlRegistrationStore,
} from "@website/db/sql";
import type { EventEntity } from "@website/domain/events";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createCommitteeRoles } from "../../apps/admin/src/server/event-committee";
import { createCheckInActions, ticketHash } from "../../apps/admin/src/server/event-checkin";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlEventStore>[0];
const registered = new Date("2026-10-18T05:00:00Z");
const eventDay = new Date("2026-11-20T01:00:00Z"); // 10:00 on the day, Tokyo
const dayBefore = new Date("2026-11-19T05:00:00Z");
const staff = (userId: string, permissions: string[]): Principal => ({
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
const door1 = staff("door-1", ["events.checkin"]);
const door2 = staff("door-2", ["events.checkin"]);
const lead = staff("lead-1", ["registrants.edit"]);
const outsider = staff("nobody", ["events.read"]);
const context = () =>
  Promise.resolve({ actorEmail: "d@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
let auditSeq = 0;
const auditStub = (): AuditEvent => ({
  id: `audit-${++auditSeq}`,
  occurredAt: registered,
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

const base: Omit<EventEntity, "id" | "version" | "createdAt" | "updatedAt"> = {
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
  type: "seminar",
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
  registration: null,
  fee: null,
};

let fake: ReturnType<typeof fakeDb>;
let events: ReturnType<typeof createSqlEventStore>;
let registrations: ReturnType<typeof createSqlRegistrationStore>;
let committees: ReturnType<typeof createSqlCommitteeStore>;
let eventId = "";
let clock = eventDay;
const db = () => fake.db as unknown as Db;
const actions = () =>
  createCheckInActions({
    events: events,
    registrations,
    users: (uids) =>
      Promise.resolve(new Map(uids.map((u) => [u, { name: `Name of ${u}`, email: `${u}@x.org` }]))),
    committeeRole: createCommitteeRoles({ events, committees, now: () => clock }),
    now: () => clock,
  });
const token = (uid: string) => `token-of-${uid}`;
/** Registers a person (confirmed) and gives them a ticket, as the ticket page does. */
async function ticketFor(uid: string, slugEvent = eventId) {
  await registrations.register(slugEvent, uid, registered);
  await registrations.setTicketHash(slugEvent, uid, ticketHash(token(uid)));
}
const scan = (who: Principal, uid: string, event = eventId) =>
  actions().scan(...as(who))({ eventId: event, token: token(uid) });
const stored = (uid: string) => fake.docs.get(`eventRegistrations/${eventId}_${uid}`);

beforeEach(async () => {
  fake = fakeDb();
  clock = eventDay;
  events = createSqlEventStore(db());
  registrations = createSqlRegistrationStore(db());
  committees = createSqlCommitteeStore(db());
  eventId = (await events.write(null, null, () => base, auditStub, registered)).id;
});

describe("ticket check-in (N1.4)", () => {
  it("a scan checks the person in once; a second scan shows when", async () => {
    await ticketFor("u1");
    const first = await scan(door1, "u1");
    expect(first).toMatchObject({
      ok: true,
      data: { outcome: "checked_in", name: "Name of u1", practice: false },
    });
    expect(stored("u1")).toMatchObject({
      checkedIn: true,
      checkedInBy: "door-1",
      checkInMethod: "scan",
    });
    clock = new Date(eventDay.getTime() + 3_600_000);
    const second = await scan(door2, "u1");
    expect(second).toMatchObject({
      ok: true,
      data: { outcome: "already", at: eventDay.toISOString() },
    });
    expect(stored("u1")).toMatchObject({ checkedInBy: "door-1" });
  });

  it("a wrong, old or other-event token gets the same neutral answer and writes nothing", async () => {
    await ticketFor("u1");
    const other = (
      await events.write(null, null, () => ({ ...base, slug: "other" }), auditStub, registered)
    ).id;
    const wrong = await actions().scan(...as(door1))({ eventId, token: "guess" });
    const elsewhere = await scan(door1, "u1", other);
    expect(wrong).toEqual({
      ok: true,
      data: { outcome: "unknown", name: null, category: null, at: null, practice: false },
    });
    expect(elsewhere).toEqual(wrong);
    expect(stored("u1")).not.toHaveProperty("checkedIn");
  });

  it("only a confirmed registration has a ticket; unpaid, waiting and cancelled cannot enter", async () => {
    await registrations.register(eventId, "w", registered);
    await registrations.setTicketHash(eventId, "w", ticketHash(token("w")));
    for (const [uid, fields] of [
      ["pend", { status: "pending", payment: "unpaid" }],
      ["wait", { status: "waitlisted" }],
      ["gone", { status: "cancelled" }],
      ["sent", { status: "pending", payment: "submitted" }],
    ] as const) {
      fake.docs.set(`eventRegistrations/${eventId}_${uid}`, {
        eventId,
        userId: uid,
        createdAt: registered,
        ticketHash: ticketHash(token(uid)),
        ...fields,
      });
      const answer = await scan(door1, uid);
      expect(answer).toMatchObject({
        ok: true,
        data: {
          outcome: { pend: "not_paid", wait: "waitlisted", gone: "cancelled", sent: "not_paid" }[
            uid
          ],
        },
      });
      expect(stored(uid)).not.toHaveProperty("checkedIn");
    }
    // setTicketHash does nothing for a registration that is not confirmed
    await registrations.setTicketHash(eventId, "wait", "x");
    expect(stored("wait")).not.toMatchObject({ ticketHash: "x" });
  });

  it("before the event day a scan is practice: the card shows, nothing is stored", async () => {
    await ticketFor("u1");
    clock = dayBefore;
    expect(await scan(door1, "u1")).toMatchObject({
      ok: true,
      data: { outcome: "checked_in", practice: true },
    });
    expect(stored("u1")).not.toHaveProperty("checkedIn");
  });

  it("manual check-in shows the state first: it works for a confirmed person and refuses an unpaid one", async () => {
    await registrations.register(eventId, "u1", registered);
    fake.docs.set(`eventRegistrations/${eventId}_late`, {
      eventId,
      userId: "late",
      status: "pending",
      payment: "unpaid",
      createdAt: registered,
    });
    const a = actions();
    expect(await a.checkIn(...as(door1))({ eventId, userId: "u1" })).toMatchObject({
      data: { outcome: "checked_in" },
    });
    expect(stored("u1")).toMatchObject({ checkInMethod: "manual" });
    expect(await a.checkIn(...as(door1))({ eventId, userId: "late" })).toMatchObject({
      data: { outcome: "not_paid" },
    });
    expect(stored("late")).not.toHaveProperty("checkedIn");
    const list = await a.attendance(...as(door1))({ eventId });
    expect(list).toMatchObject({ ok: true, data: { present: 1, registered: 1 } });
  });

  it("undo: the one who checked in for 10 minutes, a registrants editor at any time", async () => {
    await ticketFor("u1");
    await scan(door1, "u1");
    const a = actions();
    const undo = (who: Principal) => a.undo(...as(who))({ eventId, userId: "u1" });
    expect(await undo(door2)).toMatchObject({ error: "refused" });
    clock = new Date(eventDay.getTime() + 11 * 60_000);
    expect(await undo(door1)).toMatchObject({ error: "refused" });
    expect(stored("u1")).toMatchObject({ checkedIn: true });
    expect(await undo(lead)).toMatchObject({ ok: true });
    expect(stored("u1")).toMatchObject({ checkedIn: false, checkedInAt: null });
    expect(await undo(lead)).toMatchObject({ error: "refused" });
    // within the window the same person can undo and scan again
    await scan(door1, "u1");
    clock = new Date(clock.getTime() + 9 * 60_000);
    expect(await undo(door1)).toMatchObject({ ok: true });
  });

  it("the list tells who may undo", async () => {
    await ticketFor("u1");
    await scan(door1, "u1");
    const view = (who: Principal) => actions().attendance(...as(who))({ eventId });
    expect(await view(door1)).toMatchObject({ data: { people: [{ canUndo: true }] } });
    expect(await view(door2)).toMatchObject({ data: { people: [{ canUndo: false }] } });
    expect(await view(lead)).toMatchObject({ data: { people: [{ canUndo: true }] } });
  });

  it("needs events.checkin (or registrants.edit)", async () => {
    await ticketFor("u1");
    expect(await scan(outsider, "u1")).toMatchObject({ error: "forbidden" });
    expect(await actions().checkIn(...as(outsider))({ eventId, userId: "u1" })).toMatchObject({
      error: "forbidden",
    });
    expect(await actions().attendance(...as(outsider))({ eventId })).toMatchObject({
      error: "forbidden",
    });
    expect(await scan(lead, "u1")).toMatchObject({ ok: true });
  });

  it("counts the people present per event for the sponsorship reach", async () => {
    await ticketFor("u1");
    await ticketFor("u2");
    await scan(door1, "u1");
    await scan(door1, "u2");
    await registrations.register(eventId, "u3", registered);
    expect(await registrations.checkedInCounts()).toEqual(new Map([[eventId, 2]]));
  });
});

describe("check-in by committee seat (N1.5)", () => {
  const helper = staff("helper-1", ["events.read"]);
  const seatOf = (userId: string, divisionId: string) => ({
    userId,
    name: "",
    divisionId,
    seat: "member" as const,
  });
  const seed = (members: ReturnType<typeof seatOf>[]) =>
    committees.save(
      eventId,
      null,
      {
        divisions: [
          { id: "board", name: "Board", parentId: null, quota: null, description: "" },
          { id: "door", name: "Door", parentId: null, quota: null, description: "" },
        ],
        members,
      },
      () => auditStub(),
      registered,
    );

  it("a seat holder without staff rights scans on this event only", async () => {
    await ticketFor("u1");
    await seed([seatOf("helper-1", "door")]);
    expect(await scan(helper, "u1")).toMatchObject({ ok: true, data: { outcome: "checked_in" } });
    expect(await scan(outsider, "u2")).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("someone without a seat cannot scan", async () => {
    await ticketFor("u1");
    await seed([seatOf("someone-else", "door")]);
    expect(await scan(helper, "u1")).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("the seat stops working 14 days after the event", async () => {
    await ticketFor("u1");
    await seed([seatOf("helper-1", "door")]);
    clock = new Date(eventDay.getTime() + 15 * 86_400_000);
    expect(await scan(helper, "u1")).toMatchObject({ ok: false, error: "forbidden" });
  });
});
