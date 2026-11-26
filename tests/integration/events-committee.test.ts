import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import { createSqlCommitteeStore, createSqlEventStore } from "@website/db/sql";
import type { EventEntity } from "@website/domain/events";
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
const input = (version: number | null, members: unknown[] = []) => ({
  eventId,
  version,
  committee: {
    divisions: [
      { id: "board", name: "Board", parentId: null, quota: 2, description: "" },
      { id: "logi", name: "Logistics", parentId: null, quota: null, description: "" },
    ],
    members,
  },
});
const actions = () =>
  createCommitteeActions({
    events: createSqlEventStore(fake.db as unknown as Db),
    committees: createSqlCommitteeStore(fake.db as unknown as Db),
    users: (uids) =>
      Promise.resolve(
        new Map(
          uids
            .filter((u) => u !== "gone")
            .map((u) => [u, { name: `Name ${u}`, email: `${u}@x.org` }]),
        ),
      ),
    findPeople: () => Promise.resolve([{ uid: "u1", name: "Name u1", email: "u1@x.org" }]),
    now: () => now,
  });

beforeEach(async () => {
  fake = fakeDb();
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
