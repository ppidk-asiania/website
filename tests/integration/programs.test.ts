import { beforeEach, describe, expect, it } from "vitest";
import { createSqlProgramStore } from "@website/db/sql";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import {
  canManageProgram,
  canOpenProgram,
  createProgramActions,
} from "../../apps/admin/src/server/programs";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlProgramStore>[0];
let clock = new Date("2026-11-04T03:00:00Z");
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

const director = staff("dir", ["programs.edit"], { type: "orgUnit", orgUnitId: "media" });
const sekjen = staff("sekjen", ["programs.approve"]);
const pic = staff("pic", ["programs.read"]);
const officer = staff("officer", ["programs.read"]);

let fake: ReturnType<typeof fakeDb>;
let uuids = 0;
const opened: string[] = [];
const told: string[] = [];
const db = () => fake.db as unknown as Db;
const store = () => createSqlProgramStore(db());
const actions = () =>
  createProgramActions({
    programs: store(),
    unitPath: (id) => {
      const unit = fake.docs.get(`orgUnits/${id}`) as { path: string[] } | undefined;
      return Promise.resolve(unit ? [...unit.path, id] : null);
    },
    findUserId: (email) =>
      Promise.resolve({ "pic@example.org": "pic", "rina@example.org": "rina" }[email] ?? null),
    afterLpj: (lpj) => {
      opened.push(lpj.id);
      return Promise.resolve();
    },
    afterStep: (program) => {
      told.push(`${program.status}${program.reviewNote ? "+note" : ""}`);
      return Promise.resolve();
    },
    afterRevision: (revision, program) => {
      told.push(`${revision.status}:${program.name}`);
      return Promise.resolve();
    },
    now: () => clock,
    uuid: () => `m${(uuids += 1)}`,
  });

const plan = {
  name: "Webinar series",
  goal: "Share study tips",
  orgUnitId: "media",
  budgets: [
    { amountMinor: 50000, currency: "JPY" },
    { amountMinor: 1000000, currency: "IDR" },
  ],
};

async function ok<T>(result: Promise<{ ok: boolean; data?: T }>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.data as T;
}
type Step = { version: number; status: string; progress: number };

async function draft(extra: Record<string, unknown> = {}) {
  return ok<{ id: string; version: number }>(
    actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan: { ...plan, ...extra },
      picEmails: ["PIC@example.org"],
    }),
  );
}
async function proposal(extra: Record<string, unknown> = {}) {
  const { id, version } = await draft(extra);
  const sent = await ok<Step>(actions().submit(...as(director))({ id, version }));
  return { id, version: sent.version };
}
async function approved(extra: Record<string, unknown> = {}) {
  const { id, version } = await proposal(extra);
  const step = await ok<Step>(actions().approve(...as(sekjen))({ id, version }));
  return { id, version: step.version };
}

beforeEach(() => {
  fake = fakeDb();
  uuids = 0;
  opened.length = 0;
  told.length = 0;
  clock = new Date("2026-11-04T03:00:00Z");
  fake.docs.set("periods/p1", { status: "active", deletedAt: null });
  fake.docs.set("periods/p0", { status: "archived", deletedAt: null });
  fake.docs.set("orgUnits/media", { periodId: "p1", path: ["dirs"], deletedAt: null });
  fake.docs.set("orgUnits/edu", { periodId: "p1", path: ["dirs"], deletedAt: null });
  fake.docs.set("objectives/o1", {
    periodId: "p1",
    deletedAt: null,
    keyResults: [{ id: "kr1" }, { id: "kr2" }],
  });
  fake.docs.set("objectives/o0", { periodId: "p0", deletedAt: null, keyResults: [{ id: "old" }] });
});

describe("programme plans (E2)", () => {
  it("a unit drafts with PICs (by e-mail), budgets per currency and several key results", async () => {
    const { id } = await draft({ keyResultIds: ["kr1", "kr2"] });
    const saved = await store().get(id);
    expect(saved).toMatchObject({
      status: "draft",
      pics: ["pic"],
      orgUnitPath: ["dirs", "media"],
      keyResultIds: ["kr1", "kr2"],
      progressPercent: 0,
      createdBy: "dir",
      budgets: plan.budgets,
    });
    expect(await store().listForPeriod("p1")).toHaveLength(1);
  });

  it("refuses an unknown PIC, a key result of another period, an archived period", async () => {
    const unknown = await actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan,
      picEmails: ["ghost@example.org"],
    });
    expect(unknown).toMatchObject({ ok: false, issues: ["No account uses ghost@example.org."] });
    for (const link of [{ keyResultIds: ["kr1", "nope"] }, { keyResultIds: ["old"] }]) {
      const result = await actions().save(...as(director))({
        version: null,
        periodId: "p1",
        plan: { ...plan, ...link },
        picEmails: [],
      });
      expect(result).toMatchObject({ ok: false, issues: ["Choose key results of this period."] });
    }
    fake.docs.set("orgUnits/old", { periodId: "p0", path: [], deletedAt: null });
    const archived = await actions().save(...as(staff("x", ["programs.edit"])))({
      version: null,
      periodId: "p0",
      plan: { ...plan, orgUnitId: "old" },
      picEmails: [],
    });
    expect(archived).toMatchObject({ ok: false, error: "refused" });
  });

  it("unit scope: a director plans only for their own unit", async () => {
    const other = await actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan: { ...plan, orgUnitId: "edu" },
      picEmails: [],
    });
    expect(other).toMatchObject({ ok: false, error: "forbidden" });
    const { id, version } = await proposal();
    const moved = await actions().save(...as(director))({
      id,
      version,
      periodId: "p1",
      plan: { ...plan, orgUnitId: "edu" },
      picEmails: [],
    });
    expect(moved).toMatchObject({ ok: false, error: "refused" });
    const edited = await ok<{ version: number }>(
      actions().save(...as(director))({
        id,
        version,
        periodId: "p1",
        plan: { ...plan, name: "Webinar series 2" },
        picEmails: ["pic@example.org", "rina@example.org", "pic@example.org"],
      }),
    );
    expect(edited.version).toBe(3);
    expect((await store().get(id))?.pics).toEqual(["pic", "rina"]);
    const unknownUnit = await actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan: { ...plan, orgUnitId: "ghost" },
      picEmails: [],
    });
    expect(unknownUnit).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("running a programme: the PIC rule", () => {
  it("the PIC (no edit role) runs it; another reader cannot; the unit director can", async () => {
    const { id, version } = await approved();
    let v = version;
    const intruder = await actions().saveMilestone(...as(officer))({
      id,
      version: v,
      title: "Committee",
      weight: 1,
    });
    expect(intruder).toMatchObject({ ok: false, error: "refused" });
    const noRole = await actions().saveMilestone(...as(staff("y", ["okr.read"])))({
      id,
      version: v,
      title: "Committee",
    });
    expect(noRole).toMatchObject({ ok: false, error: "forbidden" });

    let step = await ok<Step>(
      actions().saveMilestone(...as(pic))({ id, version: v, title: "Committee", weight: 1 }),
    );
    step = await ok<Step>(
      actions().saveMilestone(...as(director))({
        id,
        version: step.version,
        title: "Hold the event",
        weight: 3,
      }),
    );
    v = (await ok<Step>(actions().start(...as(pic))({ id, version: step.version }))).version;
    step = await ok<Step>(
      actions().markMilestone(...as(pic))({ id, version: v, milestoneId: "m1", done: true }),
    );
    expect(step).toMatchObject({ status: "running", progress: 25 });
    step = await ok<Step>(
      actions().saveMilestone(...as(pic))({
        id,
        version: step.version,
        milestoneId: "m1",
        title: "Committee",
        weight: 3,
      }),
    );
    expect(step.progress).toBe(50);
    expect((await store().get(id))?.progressPercent).toBe(50);
    step = await ok<Step>(
      actions().deleteMilestone(...as(pic))({ id, version: step.version, milestoneId: "m2" }),
    );
    expect(step.progress).toBe(100);
    step = await ok<Step>(
      actions().health(...as(pic))({
        id,
        version: step.version,
        health: "at_risk",
        reason: "Venue unsure",
      }),
    );
    const noReason = await actions().health(...as(pic))({
      id,
      version: step.version,
      health: "on_track",
      reason: "",
    });
    expect(noReason).toMatchObject({ ok: false, error: "invalid_input" });
    step = await ok<Step>(actions().finish(...as(pic))({ id, version: step.version }));
    expect(step.status).toBe("finished");
    expect(opened).toEqual([id]);
    const audit = [...fake.docs.entries()].filter(([path]) => path.startsWith("auditLogs/"));
    expect(audit.length).toBeGreaterThanOrEqual(8);
  });

  it("canManageProgram: listed PIC or programs.edit of the unit; inactive never", () => {
    const program = { pics: ["pic"], orgUnitPath: ["dirs", "media"] };
    expect(canManageProgram(pic, program)).toBe(true);
    expect(canManageProgram(director, program)).toBe(true);
    expect(canManageProgram(officer, program)).toBe(false);
    expect(canManageProgram({ ...pic, active: false }, program)).toBe(false);
  });

  it("approve, return with a note and cancel need programs.approve", async () => {
    const { id, version } = await proposal();
    const self = await actions().approve(...as(director))({ id, version });
    expect(self).toMatchObject({ ok: false, error: "forbidden" });
    const back = await ok<Step>(
      actions().returnToProposal(...as(sekjen))({ id, version, note: "Budget?" }),
    );
    expect(back.status).toBe("draft");
    expect(told).toEqual(["proposed", "draft+note"]);
    expect((await store().get(id))?.reviewNote).toBe("Budget?");
    const again = await ok<Step>(actions().submit(...as(director))({ id, version: back.version }));
    const approvedStep = await ok<Step>(
      actions().approve(...as(sekjen))({ id, version: again.version }),
    );
    const refused = await actions().returnToProposal(...as(sekjen))({
      id,
      version: approvedStep.version,
      note: "Too late",
    });
    expect(refused).toMatchObject({ ok: false, issues: ["Only proposals can be returned."] });
    const cancelled = await ok<Step>(
      actions().cancel(...as(sekjen))({ id, version: approvedStep.version, note: "No venue" }),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(told).toEqual(["proposed", "draft+note", "proposed", "approved"]);
    const edit = await actions().save(...as(director))({
      id,
      version: cancelled.version,
      periodId: "p1",
      plan,
      picEmails: [],
    });
    expect(edit).toMatchObject({ ok: false, issues: [expect.stringContaining("closed")] });
  });
});

describe("draft, withdraw and delete (the author)", () => {
  const author = staff("dir", ["programs.read"]);
  it("the proposer withdraws an undecided proposal; the author deletes a draft or proposal", async () => {
    const { id, version } = await proposal();
    const notAuthor = await actions().withdraw(...as(pic))({ id, version });
    expect(notAuthor).toMatchObject({ ok: false, error: "refused" });
    const withdrawn = await ok<Step>(actions().withdraw(...as(author))({ id, version }));
    expect(withdrawn.status).toBe("draft");
    const stranger = await actions().remove(...as(staff("x", ["programs.read"])))({
      id,
      version: withdrawn.version,
    });
    expect(stranger).toMatchObject({ ok: false, error: "refused" });
    await ok(actions().remove(...as(author))({ id, version: withdrawn.version }));
    expect((await store().get(id))?.deletedAt).toEqual(clock);
    expect(await store().listForPeriod("p1")).toEqual([]);
  });

  it("an approved programme is never deleted and a draft is never approved", async () => {
    const { id, version } = await approved();
    const gone = await actions().remove(...as(author))({ id, version });
    expect(gone).toMatchObject({ ok: false, error: "refused" });
    const other = await draft();
    const early = await actions().approve(...as(sekjen))({ id: other.id, version: other.version });
    expect(early).toMatchObject({ ok: false, issues: ["Only proposals can be approved."] });
  });
});

describe("the approved plan changes only through a decided revision", () => {
  const changes = { name: "Webinar series 2", keyResultIds: ["kr1", "kr2"] };
  const request = async (id: string, extra: Record<string, unknown> = {}) =>
    ok<{ id: string }>(
      actions().requestRevision(...as(pic))({ id, changes, reason: "New sponsor", ...extra }),
    );
  const audits = (type: string) =>
    [...fake.docs.values()].filter((e) => (e as { resourceType?: string }).resourceType === type);

  it("the locked plan is refused on save, but PICs and the background stay free", async () => {
    const { id, version } = await approved();
    const locked = await actions().save(...as(director))({
      id,
      version,
      periodId: "p1",
      plan: { ...plan, name: "Renamed" },
      picEmails: ["pic@example.org"],
    });
    expect(locked).toMatchObject({ ok: false, error: "refused" });
    const free = await ok<{ version: number }>(
      actions().save(...as(director))({
        id,
        version,
        periodId: "p1",
        plan: { ...plan, description: "Background" },
        picEmails: ["pic@example.org", "rina@example.org"],
      }),
    );
    expect(free.version).toBe(version + 1);
    expect(await store().get(id)).toMatchObject({ pics: ["pic", "rina"], name: plan.name });
  });

  it("a PIC requests, another approver decides: plan and audit change in one transaction", async () => {
    const { id, version } = await approved();
    const { id: revisionId } = await request(id);
    expect(await store().get(id)).toMatchObject({ name: plan.name, keyResultIds: [] });
    expect(await store().listPendingRevisions("p1")).toHaveLength(1);

    const second = await actions().requestRevision(...as(pic))({ id, changes, reason: "Again" });
    expect(second).toMatchObject({
      ok: false,
      issues: ["This programme already has a revision waiting."],
    });
    const nobody = await actions().decideRevision(...as(pic))({
      id: revisionId,
      verdict: "approved",
    });
    expect(nobody).toMatchObject({ ok: false, error: "forbidden" });

    const done = await ok<{ status: string }>(
      actions().decideRevision(...as(sekjen))({ id: revisionId, verdict: "approved" }),
    );
    expect(done.status).toBe("approved");
    expect(told.slice(-2)).toEqual(["pending:Webinar series", "approved:Webinar series 2"]);
    expect(await store().get(id)).toMatchObject({
      name: "Webinar series 2",
      keyResultIds: ["kr1", "kr2"],
      status: "approved",
      version: version + 1,
      pics: ["pic"],
    });
    expect(await store().getRevision(revisionId)).toMatchObject({
      status: "approved",
      decidedBy: "sekjen",
      requestedBy: "pic",
      reason: "New sponsor",
    });
    expect(audits("programRevision")).toHaveLength(2);
    const last = audits("program")[audits("program").length - 1];
    expect(last).toMatchObject({ action: "UPDATE", title: "Webinar series 2" });
    await request(id, { changes: { goal: "More" } });
  });

  it("the requester never decides their own revision, not even with programs.approve", async () => {
    const { id } = await approved();
    const { id: revisionId } = await request(id);
    const own = await actions().decideRevision(...as(pic))({ id: revisionId, verdict: "rejected" });
    expect(own).toMatchObject({ ok: false, error: "forbidden" });
    const sameDesk = staff("pic", ["programs.read", "programs.approve"]);
    const refused = await actions().decideRevision(...as(sameDesk))({
      id: revisionId,
      verdict: "approved",
    });
    expect(refused).toMatchObject({
      ok: false,
      issues: ["Someone else must decide your revision."],
    });
    expect((await store().getRevision(revisionId))?.status).toBe("pending");
  });

  it("a rejected revision is kept, changes nothing and frees the slot", async () => {
    const { id, version } = await approved();
    const { id: revisionId } = await request(id);
    await ok(actions().decideRevision(...as(sekjen))({ id: revisionId, verdict: "rejected" }));
    expect(await store().get(id)).toMatchObject({ name: plan.name, version });
    expect((await store().listRevisions(id)).map((r) => r.status)).toEqual(["rejected"]);
    const again = await request(id);
    expect((await store().listRevisions(id)).map((r) => r.id)).toContain(again.id);
    const twice = await actions().decideRevision(...as(sekjen))({
      id: revisionId,
      verdict: "approved",
    });
    expect(twice).toMatchObject({ ok: false, issues: ["This revision is already decided."] });
  });

  it("only approved or running programmes take a revision; it is checked like a plan", async () => {
    const early = await proposal();
    const notYet = await actions().requestRevision(...as(pic))({
      id: early.id,
      changes,
      reason: "x",
    });
    expect(notYet).toMatchObject({ ok: false, error: "refused" });
    const { id } = await approved();
    const bad = await actions().requestRevision(...as(pic))({
      id,
      changes: { keyResultIds: ["old"] },
      reason: "x",
    });
    expect(bad).toMatchObject({ ok: false, issues: ["Choose key results of this period."] });
    const noReason = await actions().requestRevision(...as(pic))({ id, changes, reason: " " });
    expect(noReason).toMatchObject({ ok: false, error: "invalid_input" });
    const empty = await actions().requestRevision(...as(pic))({ id, changes: {}, reason: "x" });
    expect(empty).toMatchObject({ ok: false, error: "invalid_input" });
    const stranger = await actions().requestRevision(...as(officer))({ id, changes, reason: "x" });
    expect(stranger).toMatchObject({ ok: false, error: "refused" });
    const moved = await actions().requestRevision(...as(pic))({
      id,
      changes: { orgUnitId: "edu" },
      reason: "x",
    });
    expect(moved).toMatchObject({
      ok: false,
      issues: ["You can only plan programmes of your own unit."],
    });
  });

  it("an approval after the programme was closed is refused; rejecting still works", async () => {
    const { id, version } = await approved();
    const { id: revisionId } = await request(id);
    await ok(actions().cancel(...as(sekjen))({ id, version, note: "Stopped" }));
    const late = await actions().decideRevision(...as(sekjen))({
      id: revisionId,
      verdict: "approved",
    });
    expect(late).toMatchObject({ ok: false, error: "refused" });
    await ok(actions().decideRevision(...as(sekjen))({ id: revisionId, verdict: "rejected" }));
    const missing = await actions().decideRevision(...as(sekjen))({
      id: "ghost",
      verdict: "approved",
    });
    expect(missing).toMatchObject({ ok: false, error: "refused" });
  });
});

describe("opening a programme: the PIC page gate", () => {
  const program = { pics: ["pic"], orgUnitPath: ["dirs", "media"] };
  it("permission in scope OR listed PIC; inactive and outsiders never", () => {
    expect(canOpenProgram(staff("nobody", ["okr.read"]), program)).toBe(false);
    expect(canOpenProgram(staff("pic", ["okr.read"]), program)).toBe(true);
    expect(canOpenProgram(officer, program)).toBe(true);
    expect(
      canOpenProgram(staff("o", ["programs.read"], { type: "orgUnit", orgUnitId: "edu" }), program),
    ).toBe(false);
    expect(canOpenProgram({ ...pic, active: false }, program)).toBe(false);
  });
});

describe("weekly check-in: one per programme per UTC week", () => {
  it("a second check-in in the same week updates it; the next week is a new one", async () => {
    const { id, version } = await proposal();
    const early = await actions().checkIn(...as(pic))({ id, achievements: "Planned" });
    expect(early).toMatchObject({ ok: false, error: "refused" });
    await ok(actions().approve(...as(sekjen))({ id, version }));

    const first = await ok<{ id: string; weekStart: string }>(
      actions().checkIn(...as(pic))({ id, achievements: "Booked the venue" }),
    );
    expect(first).toEqual({ id: `${id}_2026-11-02`, weekStart: "2026-11-02" });
    clock = new Date("2026-11-08T23:59:00Z");
    await ok(
      actions().checkIn(...as(pic))({
        id,
        achievements: "Booked the venue, speakers",
        blockers: "",
      }),
    );
    let list = await store().listCheckins(id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      achievements: "Booked the venue, speakers",
      createdAt: new Date("2026-11-04T03:00:00Z"),
      updatedAt: clock,
    });
    clock = new Date("2026-11-09T00:00:00Z");
    await ok(actions().checkIn(...as(pic))({ id, achievements: "Rehearsal" }));
    list = await store().listCheckins(id);
    expect(list.map((c) => c.weekStart)).toEqual(["2026-11-09", "2026-11-02"]);

    const empty = await actions().checkIn(...as(pic))({ id, achievements: "" });
    expect(empty).toMatchObject({ ok: false, error: "invalid_input" });
    const stranger = await actions().checkIn(...as(officer))({ id, achievements: "x" });
    expect(stranger).toMatchObject({ ok: false, error: "refused" });
    const missing = await actions().checkIn(...as(officer))({ id: "ghost", achievements: "x" });
    expect(missing).toMatchObject({ ok: false, error: "refused" });
    const audit = [...fake.docs.values()].filter(
      (entry) => (entry as { resourceType?: string }).resourceType === "checkin",
    ) as Array<{ action: string }>;
    expect(audit.map((e) => e.action)).toEqual(["CREATE", "UPDATE", "CREATE"]);
  });

  it("a check-in of a programme that disappeared meanwhile is refused", async () => {
    await expect(
      store().checkIn(
        "ghost",
        "2026-11-02",
        { achievements: "x", blockers: "", nextPlan: "" },
        "u",
        () => {
          throw new Error("not reached");
        },
        clock,
      ),
    ).rejects.toThrow("does not exist");
  });
});
