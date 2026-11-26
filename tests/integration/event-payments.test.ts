import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "@website/audit";
import {
  createSqlEventReader,
  createSqlEventStore,
  createSqlRegistrationStore,
} from "@website/db/sql";
import {
  TicketUnavailableError,
  type EventEntity,
  type EventFee,
  type RegistrationDetails,
} from "@website/domain/events";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createEventRegistrationActions } from "../../apps/admin/src/server/event-registration";
import { createEventProofUpload } from "../../apps/web/src/server/event-proof";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlEventStore>[0];
const now = new Date("2026-11-02T05:00:00Z");
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

const fee: EventFee = {
  paid: true,
  currency: "CNY",
  categories: [
    { id: "std", label: "Student", amountMinor: 5000, earlyAmountMinor: 3000, quota: 2 },
    { id: "pro", label: "Professional", amountMinor: 9000, earlyAmountMinor: null, quota: null },
  ],
  earlyUntil: new Date("2026-11-10T00:00:00Z"),
  instructions: "Transfer, then upload the receipt.",
  payImage: null,
};
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
  registration: { formId: "form-1", attendanceModes: [], showOnTicket: "", shortUrl: null },
  fee,
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const checker = (uid = "checker"): Principal => ({
  kind: "user",
  userId: uid,
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(["events.payments", "events.edit"])),
    },
  ],
});
const viewer: Principal = {
  kind: "user",
  userId: "viewer",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(["events.read"])),
    },
  ],
};
const context = () =>
  Promise.resolve({ actorEmail: "x@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;

let fake: ReturnType<typeof fakeDb>;
let events: ReturnType<typeof createSqlEventStore>;
let registrations: ReturnType<typeof createSqlRegistrationStore>;
let eventId = "";
let files: Map<string, string>;
let at = now;
const decided = vi.fn((..._args: unknown[]) => Promise.resolve());
const db = () => fake.db as unknown as Db;

const details = (feeCategory: string | null): RegistrationDetails => ({
  attendanceMode: null,
  responseId: null,
  formVersion: null,
  feeCategory,
});
const register = (uid: string, category: string | null = "std", when = at) =>
  db().runTransaction((tx) => registrations.registerIn(tx, eventId, uid, when, details(category)));
const regId = (uid: string) => `${eventId}_${uid}`;
const doc = (path: string) => fake.docs.get(path) as Record<string, unknown> | undefined;

const actions = () =>
  createEventRegistrationActions({
    events,
    forms: {
      get: () => Promise.resolve(null),
      listResponses: () => Promise.resolve([]),
      listVersions: () => Promise.resolve([]),
    },
    registrations,
    users: () => Promise.resolve(new Map()),
    shorten: (url) => Promise.resolve(url),
    storage: {
      signedReadUrl: (path) => Promise.resolve(`https://web.test/private-files?t=${path}`),
    },
    notify: { paymentDecided: decided },
    uuid: () => crypto.randomUUID(),
    webUrl: "https://ppi.example.org",
    now: () => at,
  });

const proofUpload = () =>
  createEventProofUpload({
    events: createSqlEventReader(db()),
    registrations,
    storage: {
      save: (path) => {
        files.set(path, "saved");
        return Promise.resolve();
      },
      remove: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
    },
    now: () => at,
    uuid: () => crypto.randomUUID(),
  });
const sendProof = (uid: string | null, body: Uint8Array = PNG) =>
  proofUpload()(
    uid === null ? null : { uid },
    "simposium",
    new Request("https://web.test/p", { method: "POST", body: body as unknown as ArrayBuffer }),
  );

beforeEach(async () => {
  fake = fakeDb();
  files = new Map();
  at = now;
  decided.mockClear();
  events = createSqlEventStore(db());
  registrations = createSqlRegistrationStore(db());
  eventId = (await events.write(null, null, () => base, auditStub, now)).id;
  fake.docs.set("settings/activePeriod", { periodId: "p1" });
});

describe("registering for a paid event (N1.3)", () => {
  it("holds the seat as pending and unpaid, and counts it against the category quota", async () => {
    expect(await register("u1")).toEqual({ status: "pending", created: true });
    expect(doc(`eventRegistrations/${regId("u1")}`)).toMatchObject({
      status: "pending",
      payment: "unpaid",
      feeCategory: "std",
    });
    expect(doc(`eventCounters/${eventId}`)).toMatchObject({ confirmed: 1, categories: { std: 1 } });
    await register("u2");
    await expect(register("u3")).rejects.toBeInstanceOf(TicketUnavailableError);
    expect(await register("u3", "pro")).toMatchObject({ status: "pending" });
    // The same person again changes nothing, even in a full category.
    expect(await register("u1")).toEqual({ status: "pending", created: false });
  });

  it("refuses an unknown category, a missing one, and a price that is not set yet", async () => {
    await expect(register("u1", "vip")).rejects.toThrow(/category/);
    await expect(register("u1", null)).rejects.toThrow(/category/);
    await events.write(
      eventId,
      1,
      (c) => ({ ...c!, fee: { ...fee, categories: [] } }),
      auditStub,
      now,
    );
    await expect(register("u1")).rejects.toBeInstanceOf(TicketUnavailableError);
  });

  it("keeps the event's capacity: a full event waitlists and asks for no payment", async () => {
    await events.write(eventId, 1, (c) => ({ ...c!, capacity: 1 }), auditStub, now);
    await register("u1");
    expect(await register("u2", "pro")).toEqual({ status: "waitlisted", created: true });
    expect(doc(`eventRegistrations/${regId("u2")}`)).toMatchObject({ payment: "not_required" });
    expect(doc(`eventCounters/${eventId}`)).toMatchObject({ confirmed: 1, waitlisted: 1 });
  });

  it("is refused one-click, and a free event refuses a category", async () => {
    await events.write(eventId, 1, (c) => ({ ...c!, registration: null }), auditStub, now);
    await expect(registrations.register(eventId, "u1", now)).rejects.toThrow(/form page/);
    await events.write(
      eventId,
      2,
      (c) => ({ ...c!, registration: base.registration, fee: null }),
      auditStub,
      now,
    );
    await expect(register("u1", "std")).rejects.toThrow(/no ticket categories/);
  });
});

describe("the proof (N1.3)", () => {
  it("accepts an image once registered and unpaid, replaces it on a re-send, never for strangers", async () => {
    expect((await sendProof(null)).status).toBe(401);
    expect((await sendProof("nobody")).status).toBe(400); // not registered
    await register("u1");
    expect((await sendProof("u1", new Uint8Array([1, 2, 3, 4]))).status).toBe(400);
    expect((await sendProof("u1")).status).toBe(201);
    expect(doc(`eventRegistrations/${regId("u1")}`)).toMatchObject({ payment: "submitted" });
    expect([...files.keys()]).toHaveLength(1);
    expect((await sendProof("u1")).status).toBe(400); // waiting for a check: no second proof
    expect([...files.keys()]).toHaveLength(1); // the refused file was removed
  });

  it("refuses a proof on a free event", async () => {
    await events.write(eventId, 1, (c) => ({ ...c!, fee: null }), auditStub, now);
    expect((await sendProof("u1")).status).toBe(404);
  });
});

describe("verifying a payment writes ONE cash entry (DEC-26)", () => {
  const submitted = async (uid: string, category = "std") => {
    await register(uid, category);
    await sendProof(uid);
  };
  const verify = (p = checker(), uid = "u1") =>
    actions().verify(...as(p))({ registrationId: regId(uid) });

  it("confirms the registration, freezes the early amount and books income once", async () => {
    await submitted("u1");
    at = new Date("2026-12-01T00:00:00Z"); // after the early date: the frozen amount must not change
    expect(await verify()).toMatchObject({ ok: true, data: { changed: true } });
    expect(doc(`eventRegistrations/${regId("u1")}`)).toMatchObject({
      status: "confirmed",
      payment: "verified",
      amountMinor: 3000,
      currency: "CNY",
      reviewedBy: "checker",
    });
    const entry = doc(`cashEntries/${regId("u1")}`);
    expect(entry).toMatchObject({
      kind: "in",
      category: "event",
      amountMinor: 3000,
      currency: "CNY",
      periodId: "p1",
      source: "event",
      description: "Simposium: Student",
    });
    expect(decided).toHaveBeenCalledWith(
      expect.objectContaining({ id: eventId }),
      "u1",
      true,
      null,
      at,
    );
  });

  it("a second verify writes nothing and tells nobody again", async () => {
    await submitted("u1");
    await verify();
    const cashCount = () =>
      [...fake.docs.keys()].filter((k) => k.startsWith("cashEntries/")).length;
    expect(cashCount()).toBe(1);
    expect(await verify()).toMatchObject({ ok: true, data: { changed: false } });
    expect(cashCount()).toBe(1);
    expect(decided).toHaveBeenCalledTimes(1);
  });

  it("charges the normal price after the early date", async () => {
    at = new Date("2026-11-12T00:00:00Z");
    await submitted("u1");
    await verify();
    expect(doc(`cashEntries/${regId("u1")}`)).toMatchObject({ amountMinor: 5000 });
  });

  it("refuses the payer, a proof not sent yet, a missing period and a holder without the extra", async () => {
    await register("u1");
    expect(await verify()).toMatchObject({ error: "refused" }); // no proof yet
    await sendProof("u1");
    expect(await verify(checker("u1"))).toMatchObject({ error: "refused" }); // own payment
    expect(await verify(viewer)).toMatchObject({ error: "forbidden" });
    fake.docs.delete("settings/activePeriod");
    expect(await verify()).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("period")],
    });
    expect(doc(`eventRegistrations/${regId("u1")}`)).toMatchObject({ payment: "submitted" });
  });

  it("reject keeps the seat, shows the note and lets a new proof be sent and verified", async () => {
    await submitted("u1");
    expect(
      await actions().reject(...as(checker()))({ registrationId: regId("u1"), note: "x" }),
    ).toMatchObject({ error: "invalid_input" });
    expect(
      await actions().reject(...as(checker()))({
        registrationId: regId("u1"),
        note: "The amount is wrong",
      }),
    ).toMatchObject({ ok: true });
    expect(doc(`eventRegistrations/${regId("u1")}`)).toMatchObject({
      status: "pending",
      payment: "rejected",
      paymentNote: "The amount is wrong",
    });
    expect(doc(`eventCounters/${eventId}`)).toMatchObject({ confirmed: 1 });
    expect(decided).toHaveBeenCalledWith(expect.anything(), "u1", false, "The amount is wrong", at);
    expect((await sendProof("u1")).status).toBe(201);
    expect(doc(`eventRegistrations/${regId("u1")}`)).toMatchObject({
      payment: "submitted",
      paymentNote: null,
    });
    expect(await verify()).toMatchObject({ ok: true, data: { changed: true } });
  });

  it("lists registrants with category, amount and payment state, and opens only the proof of a checker", async () => {
    await submitted("u1");
    const listed = await actions().registrants(...as(checker()))({ eventId });
    expect(listed).toMatchObject({
      ok: true,
      data: {
        rows: [
          {
            registrationId: regId("u1"),
            payment: "submitted",
            category: "Student",
            amount: "CNY 30.00",
            hasProof: true,
          },
        ],
      },
    });
    const open = await actions().openProof(regId("u1"), checker());
    expect(open.status).toBe(302);
    expect(open.headers.get("Location")).toContain("events/proofs/");
    expect((await actions().openProof(regId("u1"), viewer)).status).toBe(403);
    expect((await actions().openProof(regId("u1"), null)).status).toBe(401);
    expect((await actions().openProof(regId("nobody"), checker())).status).toBe(404);
  });
});

describe("setting the fee (admin)", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    paid: true,
    currency: "CNY",
    categories: [
      { id: "std", label: "Student", amountMinor: 5000, earlyAmountMinor: 3000, quota: 2 },
      { id: "", label: "Guest", amountMinor: 7000, earlyAmountMinor: null, quota: null },
    ],
    earlyUntil: "2026-11-10T00:00:00Z",
    instructions: "Pay",
    payImage: null,
    ...over,
  });
  const ref = async () => ({ id: eventId, version: (await events.get(eventId))?.version ?? 0 });
  const save = async (fee: unknown) =>
    actions().saveFee(...as(checker()))({ ...(await ref()), fee });

  it("saves the categories, gives a new one an id, and needs the registration form first", async () => {
    expect(await save(input())).toMatchObject({ ok: true });
    const saved = (await events.get(eventId))?.fee;
    expect(saved?.categories.map((c) => c.id)[0]).toBe("std");
    expect(saved?.categories[1]?.id).toMatch(/^[0-9a-f]{10}$/);
    expect(saved?.earlyUntil).toEqual(new Date("2026-11-10T00:00:00Z"));
    await events.write(
      eventId,
      (await ref()).version,
      (c) => ({ ...c!, registration: null, fee: null }),
      auditStub,
      now,
    );
    expect(await save(input())).toMatchObject({ error: "refused" });
  });

  it("keeps a category that people registered for, and a fee that people still owe", async () => {
    await register("u1");
    expect(
      await save(input({ categories: [input().categories[1]], earlyUntil: null })),
    ).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("cannot be removed")],
    });
    expect(await save(null)).toMatchObject({ error: "refused" });
    expect(await save(input({ paid: false }))).toMatchObject({ error: "refused" });
  });

  it("the registration form cannot be removed from a paid event", async () => {
    expect(await actions().save(...as(checker()))({ ...(await ref()), setup: null })).toMatchObject(
      { error: "refused", issues: [expect.stringContaining("fee off")] },
    );
  });
});
