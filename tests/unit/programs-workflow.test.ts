import { describe, expect, it } from "vitest";
import {
  applyRevision,
  approveProgram,
  assertCanCheckIn,
  assertDeletable,
  assertPlanEditable,
  BudgetsSchema,
  cancelProgram,
  checkinId,
  completeMilestone,
  decideRevision,
  finishProgram,
  formatMoney,
  HealthInputSchema,
  ProgramInputSchema,
  progressPercent,
  removeMilestone,
  returnProgram,
  RevisionChangesSchema,
  setHealth,
  startProgram,
  submitProgram,
  upsertMilestone,
  weekStartUtc,
  withdrawProgram,
  type Program,
  type ProgramRevision,
} from "@website/domain/programs";

const now = new Date("2026-11-04T03:00:00Z");
const program = (extra: Partial<Program> = {}): Program => ({
  id: "pr1",
  periodId: "p1",
  orgUnitId: "media",
  orgUnitPath: ["media"],
  keyResultIds: [],
  name: "Webinar series",
  goal: "",
  description: "",
  plannedStart: null,
  plannedEnd: null,
  budgets: [],
  pics: ["pic"],
  status: "proposed",
  progressPercent: 0,
  milestones: [],
  health: null,
  reviewNote: null,
  approvedBy: null,
  approvedAt: null,
  startedAt: null,
  finishedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdBy: "dir",
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});
const milestone = (title: string, weight: number, sort = 0) => ({
  title,
  weight,
  sort,
  dueOn: null,
});

describe("progress from weighted milestones (E2)", () => {
  it("none = 0, not 100; weights, not counts", () => {
    expect(progressPercent([])).toBe(0);
    let p = upsertMilestone(program(), "a", milestone("Committee", 1));
    p = upsertMilestone(p, "b", milestone("Hold the event", 3));
    expect(p.progressPercent).toBe(0);
    p = completeMilestone(p, "a", true, "pic", now);
    expect(p.progressPercent).toBe(25);
    p = completeMilestone(p, "b", true, "pic", now);
    expect(p.progressPercent).toBe(100);
  });

  it("is recomputed when a weight changes, a milestone is removed or opened again", () => {
    let p = upsertMilestone(program(), "a", milestone("Committee", 1));
    p = upsertMilestone(p, "b", milestone("Hold the event", 3));
    p = completeMilestone(p, "a", true, "pic", now);
    p = upsertMilestone(p, "a", milestone("Committee", 3));
    expect(p.progressPercent).toBe(50);
    expect(p.milestones.find((m) => m.id === "a")?.completedAt).toEqual(now);
    p = completeMilestone(p, "a", true, "other", new Date(0));
    expect(p.milestones.find((m) => m.id === "a")).toMatchObject({
      completedAt: now,
      completedBy: "pic",
    });
    p = removeMilestone(p, "b");
    expect(p.progressPercent).toBe(100);
    p = completeMilestone(p, "a", false, "pic", now);
    expect(p.progressPercent).toBe(0);
    expect(() => removeMilestone(p, "zz")).toThrow("does not exist");
  });

  it("keeps milestones in order (sort, then due date, undated last)", () => {
    let p = upsertMilestone(program(), "c", { ...milestone("C", 1, 1), dueOn: null });
    p = upsertMilestone(p, "b", { ...milestone("B", 1, 1), dueOn: "2026-12-01" });
    p = upsertMilestone(p, "a", milestone("A", 1, 0));
    p = upsertMilestone(p, "d", { ...milestone("D", 1, 1), dueOn: "2026-11-01" });
    expect(p.milestones.map((m) => m.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("at most 50 milestones; closed programmes never change", () => {
    let p = program();
    for (let i = 0; i < 50; i += 1) p = upsertMilestone(p, `m${i}`, milestone("M", 1));
    expect(() => upsertMilestone(p, "m51", milestone("M", 1))).toThrow("At most 50");
    const closed = program({ status: "finished", milestones: p.milestones });
    expect(() => upsertMilestone(closed, "m0", milestone("M", 2))).toThrow("closed");
    expect(() => completeMilestone(closed, "m0", true, "pic", now)).toThrow("closed");
    expect(() => removeMilestone(program({ status: "cancelled" }), "m0")).toThrow("closed");
  });
});

describe("status machine", () => {
  it("proposed → approved (needs a PIC) → running (needs a milestone) → finished", () => {
    expect(() => approveProgram(program({ pics: [] }), "boss", now)).toThrow("PIC");
    const approved = approveProgram(program({ reviewNote: "fix" }), "boss", now);
    expect(approved).toMatchObject({ status: "approved", approvedBy: "boss", reviewNote: null });
    expect(() => approveProgram(approved, "boss", now)).toThrow("Only proposals");
    expect(() => startProgram(approved, now)).toThrow("milestone");
    expect(() => startProgram(program(), now)).toThrow("Approve");
    const running = startProgram(upsertMilestone(approved, "a", milestone("A", 1)), now);
    expect(running).toMatchObject({ status: "running", startedAt: now });
    expect(startProgram({ ...running, status: "approved" }, new Date(0)).startedAt).toEqual(now);
    expect(() => finishProgram(approved, now)).toThrow("Only running");
    expect(finishProgram(running, now)).toMatchObject({ status: "finished", finishedAt: now });
  });

  it("a draft is submitted; return (with a note) and withdraw send a proposal back to draft", () => {
    const draft = program({ status: "draft" });
    expect(() => approveProgram(draft, "boss", now)).toThrow("Only proposals");
    const proposed = submitProgram(program({ status: "draft", reviewNote: "old" }));
    expect(proposed).toMatchObject({ status: "proposed", reviewNote: null });
    expect(() => submitProgram(proposed)).toThrow("Only drafts");
    expect(() => returnProgram(proposed, "  ")).toThrow("Say what");
    expect(returnProgram(proposed, " Add the budget ")).toMatchObject({
      status: "draft",
      reviewNote: "Add the budget",
    });
    expect(withdrawProgram(proposed, "dir")).toMatchObject({ status: "draft" });
    expect(() => withdrawProgram(proposed, "other")).toThrow("proposed it");
    expect(() => withdrawProgram(draft, "dir")).toThrow("not decided");
  });

  it("an approved programme is never returned, withdrawn or deleted; it is cancelled", () => {
    const approved = approveProgram(program(), "boss", now);
    expect(() => returnProgram(approved, "x")).toThrow("Only proposals");
    expect(() => withdrawProgram(approved, "dir")).toThrow("not decided");
    expect(() => assertDeletable(approved, "dir")).toThrow("cancelled, not deleted");
    expect(() => assertDeletable(program({ status: "cancelled" }), "dir")).toThrow("cancelled");
    expect(() => cancelProgram(program({ status: "draft" }), "x", now)).toThrow("finished");
    expect(() => cancelProgram(approved, " ", now)).toThrow("reason");
    expect(cancelProgram(approved, "No venue", now)).toMatchObject({
      status: "cancelled",
      cancelReason: "No venue",
      cancelledAt: now,
    });
    expect(() => cancelProgram(program({ status: "finished" }), "x", now)).toThrow(
      "finished programme",
    );
  });

  it("only the author deletes their own draft or undecided proposal", () => {
    expect(() => assertDeletable(program({ status: "draft" }), "dir")).not.toThrow();
    expect(() => assertDeletable(program(), "dir")).not.toThrow();
    expect(() => assertDeletable(program(), "other")).toThrow("created it");
  });
});

describe("the approved plan is locked", () => {
  const plan = {
    name: "Webinar series",
    goal: "",
    description: "",
    orgUnitId: "media",
    keyResultIds: [],
    plannedStart: null,
    plannedEnd: null,
    budgets: [],
  };
  it("draft and proposal edit freely; approved or running change only free fields", () => {
    const edited = { ...plan, name: "Other", budgets: [{ amountMinor: 5, currency: "JPY" }] };
    expect(() => assertPlanEditable(program({ status: "draft" }), edited)).not.toThrow();
    expect(() => assertPlanEditable(program(), edited)).not.toThrow();
    for (const status of ["approved", "running"] as const) {
      expect(() => assertPlanEditable(program({ status }), edited)).toThrow("ask for a revision");
      for (const locked of [
        { goal: "x" },
        { orgUnitId: "edu" },
        { plannedStart: "2026-12-01" },
        { plannedEnd: "2026-12-01" },
        { keyResultIds: ["kr1"] },
      ]) {
        expect(() => assertPlanEditable(program({ status }), { ...plan, ...locked })).toThrow(
          "locked",
        );
      }
      expect(() =>
        assertPlanEditable(program({ status }), { ...plan, description: "Background" }),
      ).not.toThrow();
    }
    expect(() => assertPlanEditable(program({ status: "finished" }), plan)).toThrow("closed");
  });

  it("key results: 0-10, each once", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `kr${i}`);
    expect(ProgramInputSchema.parse({ name: "Webinar", orgUnitId: "m" }).keyResultIds).toEqual([]);
    expect(
      ProgramInputSchema.safeParse({ name: "Webinar", orgUnitId: "m", keyResultIds: ids(10) })
        .success,
    ).toBe(true);
    expect(
      ProgramInputSchema.safeParse({ name: "Webinar", orgUnitId: "m", keyResultIds: ids(11) })
        .success,
    ).toBe(false);
    expect(
      ProgramInputSchema.safeParse({ name: "Webinar", orgUnitId: "m", keyResultIds: ["a", "a"] })
        .success,
    ).toBe(false);
  });
});

describe("plan revisions", () => {
  const approved = () => program({ status: "approved", approvedBy: "boss", approvedAt: now });
  const revision = (extra: Partial<ProgramRevision> = {}): ProgramRevision => ({
    id: "rev1",
    programId: "pr1",
    periodId: "p1",
    orgUnitPath: ["media"],
    changes: { name: "Webinar series 2", budgets: [{ amountMinor: 9, currency: "JPY" }] },
    reason: "Venue changed",
    requestedBy: "pic",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });

  it("changes: only locked plan fields, at least one, valid like the plan form", () => {
    expect(RevisionChangesSchema.safeParse({}).success).toBe(false);
    expect(RevisionChangesSchema.safeParse({ description: "x" }).success).toBe(false);
    expect(RevisionChangesSchema.safeParse({ name: "ab" }).success).toBe(false);
    expect(RevisionChangesSchema.safeParse({ goal: "" }).success).toBe(true);
    expect(RevisionChangesSchema.safeParse({ plannedStart: null }).success).toBe(true);
  });

  it("an approved revision rewrites only the changed fields; a rejected one changes nothing", () => {
    const done = decideRevision(revision(), approved(), "approved", "boss", now);
    expect(done.revision).toMatchObject({ status: "approved", decidedBy: "boss", decidedAt: now });
    expect(done.program).toMatchObject({
      name: "Webinar series 2",
      budgets: [{ amountMinor: 9, currency: "JPY" }],
      goal: "",
      status: "approved",
    });
    const rejected = decideRevision(revision(), approved(), "rejected", "boss", now);
    expect(rejected.revision.status).toBe("rejected");
    expect(rejected.program).toEqual(approved());
  });

  it("the requester never decides; a decided revision is final; a closed programme cannot take one", () => {
    expect(() => decideRevision(revision(), approved(), "approved", "pic", now)).toThrow(
      "Someone else",
    );
    expect(() => decideRevision(revision(), approved(), "rejected", "pic", now)).toThrow(
      "Someone else",
    );
    expect(() =>
      decideRevision(revision({ status: "rejected" }), approved(), "approved", "boss", now),
    ).toThrow("already decided");
    expect(() =>
      decideRevision(revision(), program({ status: "finished" }), "approved", "boss", now),
    ).toThrow("approved or running");
    expect(
      decideRevision(revision(), program({ status: "finished" }), "rejected", "boss", now).revision
        .status,
    ).toBe("rejected");
  });

  it("the revised plan must still be a valid plan", () => {
    expect(() =>
      applyRevision(approved(), { plannedStart: "2026-12-01", plannedEnd: "2026-11-01" }),
    ).toThrow("before the start");
  });
});

describe("health always has a reason", () => {
  it("is refused without a reason, also for on track", () => {
    expect(HealthInputSchema.safeParse({ health: "on_track", reason: "" }).success).toBe(false);
    const p = program({ status: "running" });
    expect(() => setHealth(p, "on_track", "   ", "pic", now)).toThrow("Say why");
    expect(setHealth(p, "at_risk", " Venue unsure ", "pic", now).health).toEqual({
      status: "at_risk",
      reason: "Venue unsure",
      at: now,
      by: "pic",
    });
    expect(() => setHealth(program(), "on_track", "ok", "pic", now)).toThrow("approved or running");
  });
});

describe("weekly check-in (E3)", () => {
  it("weeks start on Monday 00:00 UTC, whatever the local day", () => {
    expect(weekStartUtc(new Date("2026-11-04T03:00:00Z"))).toBe("2026-11-02");
    expect(weekStartUtc(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
    expect(weekStartUtc(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-02");
    expect(weekStartUtc(new Date("2026-11-09T00:00:00Z"))).toBe("2026-11-09");
    expect(checkinId("pr1", "2026-11-02")).toBe("pr1_2026-11-02");
  });

  it("only approved or running programmes check in", () => {
    expect(() => assertCanCheckIn({ status: "draft" })).toThrow("approved or running");
    expect(() => assertCanCheckIn({ status: "proposed" })).toThrow("approved or running");
    expect(() => assertCanCheckIn({ status: "approved" })).not.toThrow();
  });
});

describe("money display", () => {
  it("shows major units with the currency's own decimals, never converted", () => {
    expect(formatMoney({ amountMinor: 50000, currency: "JPY" })).toBe("JPY 50,000");
    expect(formatMoney({ amountMinor: 1250, currency: "AUD" })).toBe("AUD 12.50");
  });
});

describe("plan input", () => {
  const plan = { name: "Webinar series", orgUnitId: "media" };
  it("one budget line per currency, never mixed", () => {
    expect(
      BudgetsSchema.safeParse([
        { amountMinor: 100, currency: "JPY" },
        { amountMinor: 5, currency: "JPY" },
      ]).success,
    ).toBe(false);
    expect(BudgetsSchema.safeParse([{ amountMinor: 1.5, currency: "JPY" }]).success).toBe(false);
    expect(ProgramInputSchema.parse(plan).budgets).toEqual([]);
  });
  it("the end is not before the start", () => {
    expect(
      ProgramInputSchema.safeParse({
        ...plan,
        plannedStart: "2026-12-01",
        plannedEnd: "2026-11-01",
      }).success,
    ).toBe(false);
  });
});
