import { randomUUID } from "node:crypto";
import type { Database, Query, Transaction } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import { orgUnitPath, type OrgUnit, type Period } from "@website/domain/organizations";
import {
  applyRevision,
  assertCanCheckIn,
  assertCanRevise,
  assertOkrWritable,
  assertPlanEditable,
  addDaysUtc,
  checkinId,
  decideRevision,
  DEFAULT_LPJ_DEADLINE_DAYS,
  openLpj,
  periodReportCard,
  PROGRAM_STATUSES,
  type Checkin,
  type CheckinInput,
  type Health,
  type KeyResult,
  type LpjDeskSignature,
  type LpjReport,
  type LpjStatus,
  type Milestone,
  type Objective,
  type ObjectiveInput,
  type PeriodReportCard,
  type ProgramRevision,
  type RevisionChanges,
  type Program,
  type ProgramInput,
  type ProgramStatus,
} from "@website/domain/programs";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { createSluggedStore, toDate } from "./slugged";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type ObjectiveFields = Omit<Objective, Meta>;

export type ObjectiveAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Objective | null,
  next: Objective,
) => AuditEvent;

const toObjective = (id: string, data: Record<string, unknown>): Objective => ({
  id,
  periodId: data["periodId"] as string,
  orgUnitId: data["orgUnitId"] as string | null,
  orgUnitPath: data["orgUnitPath"] as string[],
  title: data["title"] as string,
  description: data["description"] as string,
  sort: data["sort"] as number,
  keyResults: (data["keyResults"] as Array<Record<string, unknown>>).map((kr) => ({
    ...(kr as unknown as KeyResult),
    measuredAt: toDate(kr["measuredAt"]),
  })),
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

export function objectiveSnapshot(o: ObjectiveFields): Snapshot {
  return {
    orgUnitId: o.orgUnitId,
    title: o.title,
    description: o.description,
    sort: o.sort,
    keyResults: o.keyResults.map((kr) => ({
      id: kr.id,
      title: kr.title,
      unit: kr.unit,
      baseline: kr.baseline,
      target: kr.target,
      current: kr.current,
      direction: kr.direction,
    })),
  };
}

async function readWritablePeriod(db: Database, tx: Transaction, periodId: string) {
  const snapshot = await tx.get(db.collection("periods").doc(safeId.parse(periodId)));
  const period = snapshot.data() as Pick<Period, "status" | "deletedAt"> | undefined;
  assertOkrWritable(period ? { status: period.status, deletedAt: toDate(period.deletedAt) } : null);
}

export async function readUnitPath(
  db: Database,
  tx: Transaction,
  orgUnitId: string | null,
  periodId: string,
): Promise<string[]> {
  if (orgUnitId === null) return [];
  const snapshot = await tx.get(db.collection("orgUnits").doc(safeId.parse(orgUnitId)));
  const unit = snapshot.data() as Omit<OrgUnit, "id"> | undefined;
  if (!unit || unit.deletedAt || unit.periodId !== periodId) {
    throw new RuleViolationError("Choose a unit of this board period.");
  }
  return orgUnitPath({ id: snapshot.id, path: unit.path });
}

export function createSqlObjectiveStore(db: Database) {
  const store = createSluggedStore<Objective>(db, {
    collection: "objectives",
    slug: null,
    fromDoc: toObjective,
    snapshot: objectiveSnapshot,
    fixed: (o) => ({
      periodId: o.periodId,
      orgUnitPath: o.orgUnitPath,
      keyResults: o.keyResults,
    }),
  });
  return {
    get: store.get,

    async listForPeriod(periodId: string): Promise<Objective[]> {
      const snapshot = await store.docs
        .where("periodId", "==", periodId)
        .where("deletedAt", "==", null)
        .get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
    },

    create(periodId: string, input: ObjectiveInput, audit: ObjectiveAudit, now: Date) {
      return store.write(
        null,
        null,
        async (_current, tx) => {
          await readWritablePeriod(db, tx, periodId);
          const path = await readUnitPath(db, tx, input.orgUnitId, periodId);
          return { ...input, periodId, orgUnitPath: path, keyResults: [], deletedAt: null };
        },
        audit,
        now,
      );
    },

    update(id: string, version: number, input: ObjectiveInput, audit: ObjectiveAudit, now: Date) {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const objective = current as Objective;
          await readWritablePeriod(db, tx, objective.periodId);
          const path = await readUnitPath(db, tx, input.orgUnitId, objective.periodId);
          return { ...objective, ...input, orgUnitPath: path };
        },
        audit,
        now,
      );
    },

    change(
      id: string,
      version: number,
      step: (objective: Objective) => Objective,
      audit: ObjectiveAudit,
      now: Date,
    ) {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const objective = current as Objective;
          await readWritablePeriod(db, tx, objective.periodId);
          return step(objective);
        },
        audit,
        now,
      );
    },
  };
}

export type SqlObjectiveStore = ReturnType<typeof createSqlObjectiveStore>;

export type ProgramFields = Omit<Program, Meta>;
export type ProgramAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Program | null,
  next: Program,
) => AuditEvent;
export type CheckinAudit = (
  before: Snapshot | null,
  after: Snapshot,
  program: Program,
  checkin: Checkin,
) => AuditEvent;

const toMilestone = (m: Record<string, unknown>): Milestone => ({
  ...(m as unknown as Milestone),
  completedAt: toDate(m["completedAt"]),
});

export const toProgram = (id: string, data: Record<string, unknown>): Program => {
  const health = data["health"] as (Omit<Health, "at"> & { at: unknown }) | null;
  return {
    id,
    periodId: data["periodId"] as string,
    orgUnitId: data["orgUnitId"] as string,
    orgUnitPath: data["orgUnitPath"] as string[],
    // Older rows hold one `keyResultId`.
    keyResultIds:
      (data["keyResultIds"] as string[] | undefined) ??
      (data["keyResultId"] ? [data["keyResultId"] as string] : []),
    name: data["name"] as string,
    goal: data["goal"] as string,
    description: data["description"] as string,
    plannedStart: data["plannedStart"] as string | null,
    plannedEnd: data["plannedEnd"] as string | null,
    budgets: data["budgets"] as Program["budgets"],
    pics: data["pics"] as string[],
    status: data["status"] as ProgramStatus,
    progressPercent: data["progressPercent"] as number,
    milestones: (data["milestones"] as Array<Record<string, unknown>>).map(toMilestone),
    health: health ? { ...health, at: toDate(health.at) as Date } : null,
    reviewNote: data["reviewNote"] as string | null,
    approvedBy: data["approvedBy"] as string | null,
    approvedAt: toDate(data["approvedAt"]),
    startedAt: toDate(data["startedAt"]),
    finishedAt: toDate(data["finishedAt"]),
    cancelledAt: toDate(data["cancelledAt"]),
    cancelReason: data["cancelReason"] as string | null,
    createdBy: data["createdBy"] as string,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
};

export function programSnapshot(p: ProgramFields): Snapshot {
  return {
    orgUnitId: p.orgUnitId,
    keyResultIds: [...p.keyResultIds],
    name: p.name,
    goal: p.goal,
    description: p.description,
    plannedStart: p.plannedStart,
    plannedEnd: p.plannedEnd,
    budgets: p.budgets.map((b) => `${b.currency} ${b.amountMinor}`),
    pics: [...p.pics],
    status: p.status,
    progressPercent: p.progressPercent,
    milestones: p.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      weight: m.weight,
      done: m.completedAt !== null,
    })),
    health: p.health && `${p.health.status}: ${p.health.reason}`,
    reviewNote: p.reviewNote,
    cancelReason: p.cancelReason,
  };
}

const stored = (p: Program) => ({
  periodId: p.periodId,
  orgUnitPath: p.orgUnitPath,
  budgets: p.budgets,
  pics: p.pics,
  milestones: p.milestones,
  health: p.health,
  approvedBy: p.approvedBy,
  approvedAt: p.approvedAt,
  startedAt: p.startedAt,
  finishedAt: p.finishedAt,
  cancelledAt: p.cancelledAt,
  createdBy: p.createdBy,
});

async function checkKeyResults(
  db: Database,
  tx: Transaction,
  keyResultIds: readonly string[],
  periodId: string,
) {
  if (keyResultIds.length === 0) return;
  const found = await tx.get(
    db.collection("objectives").where("periodId", "==", periodId).where("deletedAt", "==", null),
  );
  const known = new Set(
    found.docs.flatMap((d) => (d.data()["keyResults"] as Array<{ id: string }>).map((k) => k.id)),
  );
  if (!keyResultIds.every((id) => known.has(id))) {
    throw new RuleViolationError("Choose key results of this period.");
  }
}

export type RevisionAudit = (
  before: Snapshot | null,
  after: Snapshot,
  program: Program,
  revision: ProgramRevision,
) => AuditEvent;

const toRevision = (id: string, data: Record<string, unknown>): ProgramRevision => ({
  id,
  programId: data["programId"] as string,
  periodId: data["periodId"] as string,
  orgUnitPath: data["orgUnitPath"] as string[],
  changes: data["changes"] as RevisionChanges,
  reason: data["reason"] as string,
  requestedBy: data["requestedBy"] as string,
  status: data["status"] as ProgramRevision["status"],
  decidedBy: data["decidedBy"] as string | null,
  decidedAt: toDate(data["decidedAt"]),
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
});

const revisionSnapshot = (r: ProgramRevision): Snapshot => ({
  status: r.status,
  reason: r.reason,
  changes: Object.keys(r.changes),
  requestedBy: r.requestedBy,
  decidedBy: r.decidedBy,
});

const revisionStored = (r: ProgramRevision) => ({
  ...revisionSnapshot(r),
  changes: r.changes,
  programId: r.programId,
  periodId: r.periodId,
  orgUnitPath: r.orgUnitPath,
  decidedAt: r.decidedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toCheckin = (id: string, data: Record<string, unknown>): Checkin => ({
  id,
  programId: data["programId"] as string,
  periodId: data["periodId"] as string,
  weekStart: data["weekStart"] as string,
  userId: data["userId"] as string,
  achievements: data["achievements"] as string,
  blockers: data["blockers"] as string,
  nextPlan: data["nextPlan"] as string,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
});

const checkinSnapshot = (c: CheckinInput): Snapshot => ({
  achievements: c.achievements,
  blockers: c.blockers,
  nextPlan: c.nextPlan,
});

export function createSqlProgramStore(db: Database) {
  const store = createSluggedStore<Program>(db, {
    collection: "programs",
    slug: null,
    fromDoc: toProgram,
    snapshot: programSnapshot,
    fixed: stored,
  });
  const checkins = db.collection("programCheckins");
  const revisions = db.collection("programRevisions");
  const audit = createSqlAuditWriter(db);
  return {
    get: store.get,

    async listForPeriod(periodId: string): Promise<Program[]> {
      const snapshot = await store.docs
        .where("periodId", "==", periodId)
        .where("deletedAt", "==", null)
        .orderBy("createdAt", "desc")
        .get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data()));
    },

    create(
      periodId: string,
      input: ProgramInput,
      pics: readonly string[],
      createdBy: string,
      auditFor: ProgramAudit,
      now: Date,
    ): Promise<Program> {
      return store.write(
        null,
        null,
        async (_current, tx) => {
          await readWritablePeriod(db, tx, periodId);
          const path = await readUnitPath(db, tx, input.orgUnitId, periodId);
          await checkKeyResults(db, tx, input.keyResultIds, periodId);
          return {
            ...input,
            periodId,
            orgUnitPath: path,
            pics: [...pics],
            status: "draft",
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
            createdBy,
            deletedAt: null,
          };
        },
        auditFor,
        now,
      );
    },

    update(
      id: string,
      version: number,
      input: ProgramInput,
      pics: readonly string[],
      auditFor: ProgramAudit,
      now: Date,
    ): Promise<Program> {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const program = current as Program;
          assertPlanEditable(program, input);
          const path = await readUnitPath(db, tx, input.orgUnitId, program.periodId);
          await checkKeyResults(db, tx, input.keyResultIds, program.periodId);
          return { ...program, ...input, orgUnitPath: path, pics: [...pics] };
        },
        auditFor,
        now,
      );
    },

    transition(
      id: string,
      version: number,
      step: (program: Program) => Program,
      auditFor: ProgramAudit,
      now: Date,
    ): Promise<Program> {
      return store.write(id, version, (current) => step(current as Program), auditFor, now);
    },

    /** One open revision per programme; the request is checked like a new plan. */
    requestRevision(
      programId: string,
      changes: RevisionChanges,
      reason: string,
      requestedBy: string,
      auditFor: RevisionAudit,
      now: Date,
    ): Promise<ProgramRevision> {
      const programRef = store.docs.doc(safeId.parse(programId));
      return db.runTransaction(async (tx) => {
        const [programDoc, open] = await Promise.all([
          tx.get(programRef),
          tx.get(
            revisions.where("programId", "==", programRef.id).where("status", "==", "pending"),
          ),
        ]);
        if (!programDoc.exists) throw new RuleViolationError("This item does not exist.");
        const program = store.read(programRef.id, programDoc.data());
        if (program.deletedAt) throw new RuleViolationError("This item is in the trash.");
        assertCanRevise(program);
        if (!open.empty) {
          throw new RuleViolationError("This programme already has a revision waiting.");
        }
        const revised = applyRevision(program, changes);
        await readUnitPath(db, tx, revised.orgUnitId, program.periodId);
        await checkKeyResults(db, tx, revised.keyResultIds, program.periodId);
        const revision: ProgramRevision = {
          id: randomUUID(),
          programId: program.id,
          periodId: program.periodId,
          orgUnitPath: program.orgUnitPath,
          changes,
          reason,
          requestedBy,
          status: "pending",
          decidedBy: null,
          decidedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.create(revisions.doc(revision.id), revisionStored(revision));
        log.append(auditFor(null, revisionSnapshot(revision), program, revision));
        return revision;
      });
    },

    /** Approving rewrites the plan, the revision and the audit entries in one transaction. */
    decideRevision(
      id: string,
      verdict: "approved" | "rejected",
      uid: string,
      auditProgram: ProgramAudit,
      auditRevision: RevisionAudit,
      now: Date,
    ): Promise<{ revision: ProgramRevision; program: Program }> {
      const ref = revisions.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const revisionDoc = await tx.get(ref);
        if (!revisionDoc.exists) throw new RuleViolationError("This item does not exist.");
        const pending = toRevision(ref.id, revisionDoc.data() as Record<string, unknown>);
        const programRef = store.docs.doc(pending.programId);
        const programDoc = await tx.get(programRef);
        if (!programDoc.exists) throw new RuleViolationError("This item does not exist.");
        const current = store.read(programRef.id, programDoc.data());
        const decided = decideRevision(pending, current, verdict, uid, now);
        let program = current;
        if (verdict === "approved") {
          const path = await readUnitPath(db, tx, decided.program.orgUnitId, current.periodId);
          await checkKeyResults(db, tx, decided.program.keyResultIds, current.periodId);
          program = {
            ...decided.program,
            orgUnitPath: path,
            version: current.version + 1,
            updatedAt: now,
          };
        }
        const log = await audit.begin(tx);
        if (verdict === "approved") {
          tx.set(programRef, {
            ...programSnapshot(program),
            ...stored(program),
            version: program.version,
            createdAt: program.createdAt,
            updatedAt: now,
            deletedAt: program.deletedAt,
          });
          log.append(
            auditProgram(programSnapshot(current), programSnapshot(program), current, program),
          );
        }
        tx.set(ref, revisionStored(decided.revision));
        log.append(
          auditRevision(
            revisionSnapshot(pending),
            revisionSnapshot(decided.revision),
            program,
            decided.revision,
          ),
        );
        return { revision: decided.revision, program };
      });
    },

    async getRevision(id: string): Promise<ProgramRevision | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await revisions.doc(id).get();
      return snapshot.exists ? toRevision(id, snapshot.data() as Record<string, unknown>) : null;
    },

    /** All revisions of a programme, newest first; rejected ones are kept. */
    async listRevisions(programId: string): Promise<ProgramRevision[]> {
      const snapshot = await revisions.where("programId", "==", programId).get();
      return snapshot.docs
        .map((doc) => toRevision(doc.id, doc.data()))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async listPendingRevisions(periodId: string): Promise<ProgramRevision[]> {
      const snapshot = await revisions
        .where("periodId", "==", periodId)
        .where("status", "==", "pending")
        .get();
      return snapshot.docs
        .map((doc) => toRevision(doc.id, doc.data()))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    checkIn(
      programId: string,
      weekStart: string,
      input: CheckinInput,
      userId: string,
      auditFor: CheckinAudit,
      now: Date,
    ): Promise<Checkin> {
      const programRef = store.docs.doc(safeId.parse(programId));
      const ref = checkins.doc(checkinId(programRef.id, weekStart));
      return db.runTransaction(async (tx) => {
        const [programDoc, existing] = await Promise.all([tx.get(programRef), tx.get(ref)]);
        if (!programDoc.exists) throw new RuleViolationError("This item does not exist.");
        const program = store.read(programRef.id, programDoc.data());
        assertCanCheckIn(program);
        const previous = existing.exists
          ? toCheckin(ref.id, existing.data() as Record<string, unknown>)
          : null;
        const checkin: Checkin = {
          ...input,
          id: ref.id,
          programId: program.id,
          periodId: program.periodId,
          weekStart,
          userId,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.set(ref, {
          programId: checkin.programId,
          periodId: checkin.periodId,
          weekStart,
          userId,
          ...checkinSnapshot(checkin),
          createdAt: checkin.createdAt,
          updatedAt: now,
        });
        log.append(
          auditFor(
            previous && checkinSnapshot(previous),
            checkinSnapshot(checkin),
            program,
            checkin,
          ),
        );
        return checkin;
      });
    },

    finish(
      id: string,
      version: number,
      decide: (program: Program) => Program,
      auditProgram: ProgramAudit,
      auditLpj: LpjAudit,
      now: Date,
    ): Promise<{ program: Program; lpj: LpjReport }> {
      const ref = store.docs.doc(safeId.parse(id));
      const lpjRef = db.collection("lpjReports").doc(ref.id);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This item does not exist.");
        const current = store.read(ref.id, snapshot.data());
        if (current.version !== version)
          throw new ConcurrencyConflictError("programs version changed");
        if (current.deletedAt) throw new RuleViolationError("This item is in the trash.");
        const program: Program = { ...decide(current), version: version + 1, updatedAt: now };
        const [period, unit] = await Promise.all([
          tx.get(db.collection("periods").doc(program.periodId)),
          tx.get(db.collection("orgUnits").doc(program.orgUnitId)),
        ]);
        const days = period.get("lpjDeadlineDays");
        const fields = openLpj(
          program,
          (unit.get("name") as string | undefined) ?? "",
          typeof days === "number" ? days : DEFAULT_LPJ_DEADLINE_DAYS,
          now,
          (period.get("endsOn") as string | undefined) ?? null,
        );
        const lpj: LpjReport = {
          ...fields,
          id: ref.id,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.set(ref, {
          ...programSnapshot(program),
          ...stored(program),
          version: program.version,
          createdAt: program.createdAt,
          updatedAt: now,
          deletedAt: null,
        });
        tx.create(lpjRef, { ...lpjStored(lpj), version: 1, createdAt: now, updatedAt: now });
        log.append(
          auditProgram(programSnapshot(current), programSnapshot(program), current, program),
        );
        log.append(auditLpj(null, lpjSnapshot(lpj), null, lpj));
        return { program, lpj };
      });
    },

    /** Ids of the programmes that have a check-in for the given UTC week. */
    async checkedIn(weekStart: string): Promise<string[]> {
      const snapshot = await checkins.where("weekStart", "==", weekStart).get();
      return snapshot.docs.map((doc) => doc.data()["programId"] as string);
    },

    async listCheckins(programId: string): Promise<Checkin[]> {
      const snapshot = await checkins.where("programId", "==", programId).get();
      return snapshot.docs
        .map((doc) => toCheckin(doc.id, doc.data()))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    },
  };
}

export type SqlProgramStore = ReturnType<typeof createSqlProgramStore>;

export type LpjAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: LpjReport | null,
  next: LpjReport,
) => AuditEvent;

const deskOf = (value: unknown): LpjDeskSignature | null => {
  const desk = value as { uid: string; at: unknown } | null;
  return desk ? { uid: desk.uid, at: toDate(desk.at) as Date } : null;
};

export function toLpj(id: string, data: Record<string, unknown>): LpjReport {
  const plan = data["plan"] as LpjReport["plan"] & { startedAt: unknown; finishedAt: unknown };
  return {
    id,
    programId: data["programId"] as string,
    periodId: data["periodId"] as string,
    orgUnitPath: data["orgUnitPath"] as string[],
    pics: data["pics"] as string[],
    plan: {
      ...plan,
      startedAt: toDate(plan.startedAt),
      finishedAt: toDate(plan.finishedAt) as Date,
    },
    dueOn: data["dueOn"] as string,
    status: data["status"] as LpjStatus,
    realization: data["realization"] as string,
    obstacles: data["obstacles"] as string,
    recommendations: data["recommendations"] as string,
    participantCount: data["participantCount"] as number | null,
    realized: data["realized"] as LpjReport["realized"],
    submittedBy: data["submittedBy"] as string | null,
    submittedAt: toDate(data["submittedAt"]),
    returnNote: data["returnNote"] as string | null,
    revisionRound: data["revisionRound"] as number,
    secretariat: deskOf(data["secretariat"]),
    treasurer: deskOf(data["treasurer"]),
    approval: deskOf(data["approval"]),
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function lpjSnapshot(l: Omit<LpjReport, Meta>): Snapshot {
  return {
    status: l.status,
    dueOn: l.dueOn,
    realization: l.realization,
    obstacles: l.obstacles,
    recommendations: l.recommendations,
    participantCount: l.participantCount,
    realized: l.realized && l.realized.map((m) => `${m.currency} ${m.amountMinor}`),
    returnNote: l.returnNote,
    revisionRound: l.revisionRound,
    secretariat: l.secretariat?.uid ?? null,
    treasurer: l.treasurer?.uid ?? null,
    approval: l.approval?.uid ?? null,
  };
}

const lpjStored = (l: LpjReport) => ({
  ...lpjSnapshot(l),
  programId: l.programId,
  periodId: l.periodId,
  orgUnitPath: l.orgUnitPath,
  pics: l.pics,
  plan: l.plan,
  realized: l.realized,
  submittedBy: l.submittedBy,
  submittedAt: l.submittedAt,
  secretariat: l.secretariat,
  treasurer: l.treasurer,
  approval: l.approval,
  deletedAt: l.deletedAt,
});

export function createSqlLpjStore(db: Database) {
  const store = createSluggedStore<LpjReport>(db, {
    collection: "lpjReports",
    slug: null,
    fromDoc: toLpj,
    snapshot: lpjSnapshot,
    fixed: lpjStored,
  });
  return {
    get: store.get,

    async listForPeriod(periodId: string): Promise<LpjReport[]> {
      const snapshot = await store.docs.where("periodId", "==", periodId).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    },

    transition(
      id: string,
      version: number,
      step: (lpj: LpjReport) => LpjReport,
      auditFor: LpjAudit,
      now: Date,
    ): Promise<LpjReport> {
      return store.write(id, version, (current) => step(current as LpjReport), auditFor, now);
    },
  };
}

export type SqlLpjStore = ReturnType<typeof createSqlLpjStore>;

export function createSqlPeriodReport(db: Database) {
  const programs = db.collection("programs");
  const lpj = db.collection("lpjReports");
  const count = async (query: Query) => (await query.count().get()).data().count;
  const objectives = createSqlObjectiveStore(db);
  return {
    async card(periodId: string, now: Date): Promise<PeriodReportCard> {
      const live = programs.where("periodId", "==", periodId).where("deletedAt", "==", null);
      const reports = lpj.where("periodId", "==", periodId);
      const yesterday = addDaysUtc(now, -1);
      const [okr, statusCounts, troubled, promised, approvedLpj, submitted, overdue] =
        await Promise.all([
          objectives.listForPeriod(periodId),
          Promise.all(PROGRAM_STATUSES.map((s) => count(live.where("status", "==", s)))),
          count(
            live
              .where("status", "in", ["approved", "running"])
              .where("health.status", "in", ["at_risk", "off_track"]),
          ),
          live.where("status", "in", ["approved", "running", "finished"]).get(),
          reports.where("status", "==", "approved").get(),
          count(reports.where("status", "==", "submitted")),
          count(
            reports
              .where("status", "in", ["draft", "submitted", "returned"])
              .where("dueOn", "<=", yesterday),
          ),
        ]);
      return periodReportCard({
        objectives: okr,
        counts: Object.fromEntries(
          PROGRAM_STATUSES.map((s, i) => [s, statusCounts[i] as number]),
        ) as Record<ProgramStatus, number>,
        troubled,
        plannedBudgets: promised.docs.map((d) => d.data()["budgets"] as Program["budgets"]),
        realized: approvedLpj.docs.map((d) => d.data()["realized"] as Program["budgets"]),
        lpj: { submitted, approved: approvedLpj.docs.length, overdue },
      });
    },
  };
}

export type SqlPeriodReport = ReturnType<typeof createSqlPeriodReport>;
