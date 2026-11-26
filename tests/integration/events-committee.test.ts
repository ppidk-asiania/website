import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "@website/audit";
import { createSqlCommitteeStore, createSqlEventStore } from "@website/db/sql";
import type { CommitteeRole, EventEntity } from "@website/domain/events";
import type { Form, FormResponse } from "@website/domain/forms";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createCommitteeActions } from "../../apps/admin/src/server/event-committee";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlEventStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
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
const editor = staff(["events.edit"]);
const reader = staff(["events.read"]);
const context = () =>
  Promise.resolve({ actorEmail: "e@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;
const auditStub = (): AuditEvent => ({
  id: "audit-1",
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

let fake: ReturnType<typeof fakeDb>;
let eventId = "";
const input = (
  version: number | null,
  members: unknown[] = [],
  applicationForms: unknown[] = [],
) => ({
  eventId,
  version,
  committee: {
    divisions: [
      { id: "board", name: "Board", parentId: null, quota: 2, description: "" },
      { id: "logi", name: "Logistics", parentId: null, quota: null, description: "" },
    ],
    members,
    applicationForms,
  },
});
let clock = now;
let seat: CommitteeRole | null = null;
let accounts = new Map<string, string>();
const placed = vi.fn(
  (_event: EventEntity, _uid: string, _placement: { seat: string; division: string } | null) =>
    Promise.resolve(),
);
const form = (respondents: Form["respondents"], id = "f1"): Form =>
  ({ id, title: "Join", usage: "public", respondents, deletedAt: null }) as unknown as Form;
let forms: Record<string, Form> = {};
let responses: FormResponse[] = [];
const response = (id: string, extra: Partial<FormResponse>): FormResponse => ({
  id,
  formId: "f1",
  version: 1,
  answers: {},
  submittedAt: now,
  ...extra,
});
const actions = () =>
  createCommitteeActions({
    events: createSqlEventStore(fake.db as unknown as Db),
    committees: createSqlCommitteeStore(fake.db as unknown as Db),
    committeeRole: () => Promise.resolve(seat),
    forms: {
      get: (id: string) => Promise.resolve(forms[id] ?? null),
      listResponses: () => Promise.resolve(responses),
      getVersion: () => Promise.resolve(null),
    },
    accountByEmail: (email: string) => {
      const uid = accounts.get(email);
      return Promise.resolve(uid ? { uid } : null);
    },
    notify: { placed },
    users: (uids) =>
      Promise.resolve(
        new Map(
          uids
            .filter((u) => u !== "gone")
            .map((u) => [u, { name: `Name ${u}`, email: `${u}@x.org` }]),
        ),
      ),
    findPeople: () => Promise.resolve([{ uid: "u1", name: "Name u1", email: "u1@x.org" }]),
    now: () => clock,
  });

beforeEach(async () => {
  fake = fakeDb();
  clock = now;
  seat = null;
  accounts = new Map();
  forms = { f1: form("guest"), f2: form("account", "f2") };
  responses = [];
  placed.mockClear();
  const events = createSqlEventStore(fake.db as unknown as Db);
  const base = {
    slug: "s",
    title: "S",
    summary: null,
    startsAt: new Date("2026-11-20T02:00:00Z"),
    endsAt: null,
    timezone: "Asia/Tokyo",
    location: "T",
    chapterId: null,
    published: true,
    capacity: null,
    registrationClosesAt: null,
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
  } as unknown as Omit<EventEntity, "id" | "version" | "createdAt" | "updatedAt">;
  eventId = (await events.write(null, null, () => base, auditStub, now)).id;
});

describe("event committee actions (N1.5)", () => {
  it("saves and loads a committee, showing account names", async () => {
    const members = [
      { userId: "u1", name: "", divisionId: "board", seat: "head" },
      { userId: null, name: "Pak Budi", divisionId: "logi", seat: "member" },
    ];
    expect(await actions().save(...as(editor))(input(null, members))).toMatchObject({
      ok: true,
      data: { version: 1 },
    });
    const loaded = await actions().load(...as(editor))({ eventId });
    expect(loaded).toMatchObject({
      ok: true,
      data: {
        version: 1,
        members: [
          { userId: "u1", shownName: "Name u1" },
          { userId: null, shownName: "Pak Budi" },
        ],
      },
    });
  });

  it("needs events.edit, refuses a stale version and an account that is gone", async () => {
    expect(await actions().save(...as(reader))(input(null))).toMatchObject({ error: "forbidden" });
    await actions().save(...as(editor))(input(null));
    expect(await actions().save(...as(editor))(input(null))).toMatchObject({ ok: false });
    const gone = [{ userId: "gone", name: "", divisionId: "board", seat: "member" }];
    expect(await actions().save(...as(editor))(input(1, gone))).toMatchObject({ error: "refused" });
  });
});

describe("committee applications (N1.6)", () => {
  const setUp = async (linked = [{ formId: "f1", kind: "volunteer" }]) => {
    await actions().save(...as(editor))(input(null, [], linked));
  };
  const place = (who: Principal, responseId: string, placement: unknown) =>
    actions().place(...as(who))({ eventId, formId: "f1", responseId, placement });
  const asSeat = { outcome: "placed", divisionId: "logi", seat: "member" } as const;

  it("links only public forms, and a committee application needs an account form", async () => {
    forms["f1"] = { ...form("guest"), usage: "recruitment" };
    expect(
      await actions().save(...as(editor))(input(null, [], [{ formId: "f1", kind: "volunteer" }])),
    ).toMatchObject({ error: "refused" });
    forms["f1"] = form("guest");
    expect(
      await actions().save(...as(editor))(input(null, [], [{ formId: "f1", kind: "committee" }])),
    ).toMatchObject({ error: "refused" });
    expect(
      await actions().save(...as(editor))(input(null, [], [{ formId: "f2", kind: "committee" }])),
    ).toMatchObject({ ok: true });
  });

  it("a placement writes the seat once; a second decision on the same answer is refused", async () => {
    await setUp();
    accounts.set("ana@x.org", "ana");
    responses = [response("r1", { name: "Ana", email: "ana@x.org" })];
    expect(await place(editor, "r1", asSeat)).toMatchObject({ ok: true, data: { placed: true } });
    expect(await place(editor, "r1", asSeat)).toMatchObject({ error: "refused" });
    expect(await actions().load(...as(editor))({ eventId })).toMatchObject({
      data: { members: [{ userId: "ana", divisionId: "logi", seat: "member" }] },
    });
    expect(placed).toHaveBeenCalledTimes(1);
    expect(placed).toHaveBeenCalledWith(expect.anything(), "ana", {
      seat: "member",
      division: "Logistics",
    });
  });

  it("a volunteer without an account becomes a typed helper and is not told", async () => {
    await setUp();
    responses = [response("r1", { name: "Pak Budi", email: "budi@x.org" })];
    await place(editor, "r1", asSeat);
    expect(await actions().load(...as(editor))({ eventId })).toMatchObject({
      data: { members: [{ userId: null, name: "Pak Budi" }] },
    });
    expect(placed).not.toHaveBeenCalled();
  });

  it("a rejection writes no seat and tells the applicant", async () => {
    await setUp();
    responses = [response("r1", { uid: "u1", name: "Ana" })];
    await place(editor, "r1", { outcome: "rejected" });
    expect(await actions().load(...as(editor))({ eventId })).toMatchObject({
      data: { members: [] },
    });
    expect(placed).toHaveBeenCalledWith(expect.anything(), "u1", null);
    const listed = await actions().applicants(...as(editor))({ eventId });
    expect(listed).toMatchObject({ data: [{ rows: [{ responseId: "r1", outcome: "rejected" }] }] });
  });

  it("nobody places themselves; a person holds one seat", async () => {
    await setUp();
    responses = [
      response("r1", { uid: "staff-1", name: "Me" }),
      response("r2", { uid: "u1", name: "Ana" }),
    ];
    expect(await place(editor, "r1", asSeat)).toMatchObject({ error: "refused" });
    expect(await place(editor, "r2", asSeat)).toMatchObject({ ok: true });
    responses = [...responses, response("r3", { uid: "u1", name: "Ana again" })];
    expect(await place(editor, "r3", asSeat)).toMatchObject({ error: "refused" });
  });

  it("the event board may place, a plain seat and strangers may not; the lock holds", async () => {
    await setUp();
    responses = [response("r1", { uid: "u1", name: "Ana" })];
    const nobody = staff(["events.read"]);
    seat = "member";
    expect(await place(nobody, "r1", asSeat)).toMatchObject({ error: "forbidden" });
    expect(await actions().applicants(...as(nobody))({ eventId })).toMatchObject({
      error: "forbidden",
    });
    seat = "board";
    clock = new Date("2026-12-10T00:00:00Z");
    expect(await place(nobody, "r1", asSeat)).toMatchObject({ error: "refused" });
    clock = now;
    expect(await place(nobody, "r1", asSeat)).toMatchObject({ ok: true });
  });
});

describe("evaluation forms and the committee gate (N1.7)", () => {
  const opens = "2026-11-21T00:00:00.000Z";
  const closes = "2026-11-28T00:00:00.000Z";
  const withEvaluation = (evaluation: Record<string, unknown>) => ({
    ...input(null, [{ userId: "u1", name: "", divisionId: "board", seat: "head" }]),
    committee: {
      ...input(null, [{ userId: "u1", name: "", divisionId: "board", seat: "head" }]).committee,
      evaluation: {
        formId: null,
        certificateNeedsAttendance: true,
        committeeFormId: null,
        committeeOpensAt: null,
        committeeClosesAt: null,
        ...evaluation,
      },
    },
  });
  const gate = (formId: string, userId: string | null, at: string) =>
    (fake.db as unknown as Db).runTransaction((tx) =>
      createSqlCommitteeStore(fake.db as unknown as Db).refuseCommitteeAnswer(
        tx,
        formId,
        userId,
        new Date(at),
      ),
    );

  it("saves the evaluation settings and loads them back", async () => {
    forms["f2"] = form("account", "f2");
    const saved = await actions().save(...as(editor))(
      withEvaluation({
        formId: "f1",
        certificateNeedsAttendance: false,
        committeeFormId: "f2",
        committeeOpensAt: opens,
        committeeClosesAt: closes,
      }),
    );
    expect(saved).toMatchObject({ ok: true });
    const loaded = await actions().load(...as(editor))({ eventId });
    expect(loaded).toMatchObject({
      data: {
        evaluation: {
          formId: "f1",
          certificateNeedsAttendance: false,
          committeeFormId: "f2",
          committeeOpensAt: new Date(opens),
          committeeClosesAt: new Date(closes),
        },
      },
    });
  });

  it("refuses a form that is not public, and a committee form that cannot name the account", async () => {
    forms["f1"] = { ...form("account"), usage: "recruitment" };
    expect(await actions().save(...as(editor))(withEvaluation({ formId: "f1" }))).toMatchObject({
      error: "refused",
    });
    forms["f1"] = form("guest");
    expect(
      await actions().save(...as(editor))(withEvaluation({ committeeFormId: "f1" })),
    ).toMatchObject({ error: "refused" });
    expect(
      await actions().save(...as(editor))(withEvaluation({ formId: "f1", committeeFormId: "f1" })),
    ).toMatchObject({ error: "invalid_input" });
  });

  it("only a member of the committee answers the committee form, inside its window", async () => {
    await actions().save(...as(editor))(
      withEvaluation({
        committeeFormId: "f2",
        committeeOpensAt: opens,
        committeeClosesAt: closes,
      }),
    );
    expect(await gate("other-form", null, "2026-11-22T00:00:00Z")).toBeNull();
    expect(await gate("f2", "u1", "2026-11-22T00:00:00Z")).toBeNull();
    expect(await gate("f2", "stranger", "2026-11-22T00:00:00Z")).toBe("not_committee");
    expect(await gate("f2", null, "2026-11-22T00:00:00Z")).toBe("not_committee");
    expect(await gate("f2", "u1", "2026-11-20T00:00:00Z")).toBe("window");
    expect(await gate("f2", "u1", "2026-12-01T00:00:00Z")).toBe("window");
  });

  it("a seat decision keeps the evaluation settings", async () => {
    await actions().save(...as(editor))({
      ...withEvaluation({ formId: "f1" }),
      committee: {
        ...withEvaluation({ formId: "f1" }).committee,
        applicationForms: [{ formId: "f1", kind: "volunteer" }],
      },
    });
    responses = [response("r1", { name: "Pak Budi" })];
    await actions().place(...as(editor))({
      eventId,
      formId: "f1",
      responseId: "r1",
      placement: { outcome: "placed", divisionId: "logi", seat: "member" },
    });
    expect(await actions().load(...as(editor))({ eventId })).toMatchObject({
      data: { evaluation: { formId: "f1" } },
    });
  });
});
