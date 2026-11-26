import { describe, expect, it } from "vitest";
import type { EventEntity } from "@website/domain/events";
import type { FinanceRequest } from "@website/domain/finance";
import type { LpjReport, ProgramRevision } from "@website/domain/programs";
import type { Task } from "@website/domain/tasks";
import type { ZoomRequest } from "@website/domain/zoom";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createDashboard } from "../../apps/admin/src/server/dashboard";
const staff = (permissions: string[], scope: Scope = { type: "global" }): Principal => ({
  kind: "user",
  userId: "u",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope,
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});

describe("admin dashboard: only what needs the viewer", () => {
  const dashboard = createDashboard({
    graduatedOfficers: () =>
      Promise.resolve([
        {
          name: "Siti",
          title: "Staf",
          graduatedOn: "2026-09-30",
          periodId: "p2026",
          orgUnitId: "media",
        },
      ]),
    lpjSecretariatHolders: () => Promise.resolve(secretariatHolders),
    activePeriod: () => Promise.resolve(period),
    finance: () => Promise.resolve(finance),
    lpj: () => Promise.resolve(lpj),
    zoom: () => Promise.resolve(zoom),
    revisions: () => Promise.resolve(revisions),
    events: () => Promise.resolve(events),
    payments: () => Promise.resolve(payments),
    myTasks: () => Promise.resolve(tasks),
    now: () => now,
  });
  let period: { id: string; name: string } | null = null;
  let secretariatHolders = 0;

  it("an account without desks sees only its own overdue tasks", async () => {
    expect(await dashboard(staff([]))).toEqual({
      queues: [],
      overdue: [tasks[0]],
      graduatedOfficers: null,
      noLpjSecretariat: false,
    });
    expect((await dashboard(staff(["appointments.edit"]))).graduatedOfficers).toEqual([
      {
        name: "Siti",
        title: "Staf",
        graduatedOn: "2026-09-30",
        periodId: "p2026",
        orgUnitId: "media",
      },
    ]);
  });

  it("warns LPJ desks, approvers and role editors when nobody holds the secretariat desk", async () => {
    for (const permissions of [["lpj.read"], ["programs.approve"], ["roles.edit"]]) {
      expect((await dashboard(staff(permissions))).noLpjSecretariat).toBe(true);
    }
    expect((await dashboard(staff(["events.read"]))).noLpjSecretariat).toBe(false);
    secretariatHolders = 1;
    expect((await dashboard(staff(["lpj.read"]))).noLpjSecretariat).toBe(false);
  });

  it("events waiting for approval go to the holders of events.publish in the event's chapter", async () => {
    const counts = async (principal: Principal) =>
      (await dashboard(principal)).queues.map((q) => [q.label, q.count]);
    expect(await counts(staff(["events.publish"]))).toEqual([["Events waiting for approval", 2]]);
    expect(await counts(staff(["events.publish"], { type: "chapter", chapterId: "jp" }))).toEqual([
      ["Events waiting for approval", 1],
    ]);
    expect(await counts(staff(["events.edit"]))).toEqual([]);
  });

  it("payment proofs waiting go to the holders of events.payments", async () => {
    const counts = async (principal: Principal) =>
      (await dashboard(principal)).queues.map((q) => [q.label, q.count]);
    expect(await counts(staff(["events.payments"]))).toEqual([["Payments waiting for a check", 3]]);
    expect(await counts(staff(["events.publish"]))).toEqual([["Events waiting for approval", 2]]);
  });

  it("queues count only what waits at my desks, in my units, that the module would let me do", async () => {
    period = { id: "p1", name: "2026" };
    const desks = [
      "finance.review",
      "finance.authorize",
      "finance.pay",
      "lpj.review_secretariat",
      "lpj.review_treasurer",
      "lpj.approve",
      "zoom.approve",
      "programs.approve",
    ];
    const counts = async (principal: Principal) =>
      (await dashboard(principal)).queues.map((q) => [q.label, q.count]);
    expect(await counts(staff(desks))).toEqual([
      ["Finance requests to review", 2],
      ["Finance requests to authorise", 1],
      ["Finance requests to pay", 1],
      ["LPJs to check (secretariat)", 1],
      ["LPJs to check (treasurer)", 1],
      ["LPJs to approve", 1],
      ["Programme plan revisions to decide", 1],
      ["Zoom bookings to approve", 1],
    ]);
    expect(await counts(staff(desks, { type: "orgUnit", orgUnitId: "other" }))).toEqual([
      ["Finance requests to review", 1],
    ]);
    expect(await counts(staff(["finance.read", "lpj.read"]))).toEqual([]);
    period = null;
    expect(await counts(staff(["finance.review", "zoom.approve"]))).toEqual([
      ["Zoom bookings to approve", 1],
    ]);
  });
});

const now = new Date("2026-11-05T00:00:00Z");
const waiting = {
  approvalRequestedAt: now,
  approvedAt: null,
  deletedAt: null,
  rejectionNote: null,
};
const payments = [{ chapterId: null }, { chapterId: null }, { chapterId: "jp" }];
const events = [
  { id: "e1", chapterId: null, ...waiting },
  { id: "e2", chapterId: "jp", ...waiting },
  { id: "e3", chapterId: null, ...waiting, approvedAt: now },
  { id: "e4", chapterId: null, ...waiting, deletedAt: now },
] as unknown as EventEntity[];
const revisions = [
  { id: "r1", requestedBy: "x", orgUnitPath: ["dirs", "media"] },
  { id: "r2", requestedBy: "u", orgUnitPath: ["dirs", "media"] },
] as unknown as ProgramRevision[];
const media = ["dirs", "media"];
const other = ["other"];
const finance = [
  { id: "f1", status: "submitted", createdBy: "x", orgUnitPath: media },
  { id: "f2", status: "submitted", createdBy: "u", orgUnitPath: media },
  { id: "f3", status: "submitted", createdBy: "x", orgUnitPath: other },
  { id: "f4", status: "reviewed", createdBy: "x", treasurer: { uid: "y" }, orgUnitPath: media },
  { id: "f5", status: "reviewed", createdBy: "x", treasurer: { uid: "u" }, orgUnitPath: media },
  { id: "f6", status: "authorized", createdBy: "x", orgUnitPath: media },
] as unknown as FinanceRequest[];
const lpjOf = (id: string, extra: object) =>
  ({
    id,
    status: "submitted",
    submittedBy: "x",
    pics: [],
    realized: {},
    secretariat: null,
    treasurer: null,
    approval: null,
    orgUnitPath: media,
    ...extra,
  }) as unknown as LpjReport;
const lpj = [
  lpjOf("l1", {}),
  lpjOf("l2", { submittedBy: "u" }),
  lpjOf("l3", { secretariat: { uid: "y" }, treasurer: { uid: "z" } }),
  lpjOf("l4", { status: "draft" }),
];
const zoom = [
  { id: "z1", status: "pending", startsAt: new Date("2026-11-06T00:00:00Z"), orgUnitPath: media },
  { id: "z2", status: "pending", startsAt: new Date("2026-11-04T00:00:00Z"), orgUnitPath: media },
  { id: "z3", status: "approved", startsAt: new Date("2026-11-06T00:00:00Z"), orgUnitPath: media },
] as unknown as ZoomRequest[];
const task = (id: string, due: string | null, done = false) =>
  ({ id, due, done, overdue: due !== null && due < "2026-11-05" }) as Task;
const tasks = [
  task("old", "2026-10-01"),
  task("soon", "2026-11-19"),
  task("later", "2026-11-20"),
  task("none", null),
  task("done", "2026-11-06", true),
];
