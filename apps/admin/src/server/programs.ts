import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type { LpjAudit, ProgramAudit, RevisionAudit, SqlProgramStore } from "@website/db/sql";
import {
  approveProgram,
  assertDeletable,
  cancelProgram,
  CheckinInputSchema,
  completeMilestone,
  finishProgram,
  HealthInputSchema,
  MAX_PICS,
  MilestoneInputSchema,
  ProgramInputSchema,
  removeMilestone,
  returnProgram,
  RevisionChangesSchema,
  RevisionReasonSchema,
  setHealth,
  startProgram,
  submitProgram,
  upsertMilestone,
  weekStartUtc,
  withdrawProgram,
  type LpjReport,
  type Program,
} from "@website/domain/programs";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal, type ResourceContext } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface ProgramDeps {
  readonly programs: Pick<
    SqlProgramStore,
    | "get"
    | "create"
    | "update"
    | "transition"
    | "checkIn"
    | "finish"
    | "requestRevision"
    | "decideRevision"
    | "getRevision"
  >;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly findUserId: (email: string) => Promise<string | null>;
  readonly afterLpj: (lpj: LpjReport) => Promise<void>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

export function canManageProgram(
  principal: Principal,
  program: Pick<Program, "pics" | "orgUnitPath">,
): boolean {
  return (
    principal.active &&
    (program.pics.includes(principal.userId) ||
      can(principal, "programs.edit", { orgUnitPath: program.orgUnitPath }))
  );
}

/** Page gate: the permission in the programme's scope, or being listed as a PIC. */
export function canOpenProgram(
  principal: Principal,
  program: Pick<Program, "pics" | "orgUnitPath">,
): boolean {
  return (
    principal.active &&
    (program.pics.includes(principal.userId) ||
      can(principal, "programs.read", { orgUnitPath: program.orgUnitPath }))
  );
}

const version = z.number().int().min(1);
const Ref = z.object({ id: safeId, version }).strict();
const WithNote = Ref.extend({ note: safeText(1000, { multiline: true }) }).strict();
const SaveProgram = z
  .object({
    id: safeId.optional(),
    version: version.nullable(),
    periodId: safeId,
    plan: ProgramInputSchema,
    picEmails: z.array(z.email("Enter the PIC's account e-mail.").max(254)).max(MAX_PICS),
  })
  .strict();
const SaveMilestone = MilestoneInputSchema.extend({
  id: safeId,
  version,
  milestoneId: safeId.optional(),
}).strict();
const MilestoneRef = Ref.extend({ milestoneId: safeId }).strict();
const CompleteMilestone = MilestoneRef.extend({ done: z.boolean() }).strict();
const SetHealth = HealthInputSchema.extend({ id: safeId, version }).strict();
const RequestRevision = z
  .object({ id: safeId, changes: RevisionChangesSchema, reason: RevisionReasonSchema })
  .strict();
const DecideRevision = z.object({ id: safeId, verdict: z.enum(["approved", "rejected"]) }).strict();
const CheckIn = CheckinInputSchema.extend({ id: safeId }).strict();

const programAudit =
  (audit: AuditBuilder, action: AuditAction): ProgramAudit =>
  (before, after, current, next) =>
    audit({
      module: "programs",
      action,
      resourceType: "program",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

const revisionAudit =
  (audit: AuditBuilder, action: AuditAction): RevisionAudit =>
  (before, after, program, revision) =>
    audit({
      module: "programs",
      action,
      resourceType: "programRevision",
      resourceId: revision.id,
      title: program.name,
      before,
      after,
      versionBefore: null,
      versionAfter: null,
      revertible: false,
    });

export const lpjAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE"): LpjAudit =>
  (before, after, current, next) =>
    audit({
      module: "lpj",
      action,
      resourceType: "lpj",
      resourceId: next.id,
      title: next.plan.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

export function createProgramActions(deps: ProgramDeps) {
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.programs.get(id))?.orgUnitPath ?? [],
  });
  const unitScope = async (orgUnitId: string): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.unitPath(orgUnitId)) ?? [],
  });
  const managed =
    (principal: Principal, step: (program: Program) => Program) => (program: Program) => {
      if (!canManageProgram(principal, program)) {
        throw new RuleViolationError("Only the programme's PICs or its unit can do this.");
      }
      return step(program);
    };

  const resolvePics = async (emails: readonly string[]): Promise<string[]> => {
    const uids: string[] = [];
    for (const email of new Set(emails.map((e) => e.toLowerCase()))) {
      const uid = await deps.findUserId(email);
      if (!uid) throw new RuleViolationError(`No account uses ${email}.`);
      uids.push(uid);
    }
    return [...new Set(uids)];
  };

  const save = createGuardedAction({
    permission: "programs.edit",
    input: SaveProgram,
    resource: (input) => (input.id ? scopeOf({ id: input.id }) : unitScope(input.plan.orgUnitId)),
    handler: async ({ id, version, periodId, plan, picEmails }, principal, audit) => {
      const now = deps.now();
      const pics = await resolvePics(picEmails);
      if (!id) {
        const saved = await deps.programs.create(
          periodId,
          plan,
          pics,
          principal.userId,
          programAudit(audit, "CREATE"),
          now,
        );
        return { id: saved.id, version: saved.version };
      }
      if (!can(principal, "programs.edit", await unitScope(plan.orgUnitId))) {
        throw new RuleViolationError("You can only plan programmes of your own unit.");
      }
      const saved = await deps.programs.update(
        id,
        version as number,
        plan,
        pics,
        programAudit(audit, "UPDATE"),
        now,
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const step = <S extends z.ZodType<{ id: string; version: number }>>(
    permission: "programs.approve" | "programs.edit" | "programs.read",
    input: S,
    decide: (program: Program, input: z.infer<S>, principal: Principal, now: Date) => Program,
    options: { action?: AuditAction; author?: true } = {},
  ) =>
    createGuardedAction({
      permission,
      input,
      resource: scopeOf,
      handler: async (parsed, principal, audit) => {
        const now = deps.now();
        const apply = (program: Program) => decide(program, parsed, principal, now);
        const saved = await deps.programs.transition(
          parsed.id,
          parsed.version,
          permission === "programs.read" && !options.author ? managed(principal, apply) : apply,
          programAudit(audit, options.action ?? "UPDATE"),
          now,
        );
        return { version: saved.version, status: saved.status, progress: saved.progressPercent };
      },
    });

  const submit = step("programs.edit", Ref, (p) => submitProgram(p));
  // The author acts on their own proposal, whether or not they are a PIC or unit editor.
  const withdraw = step(
    "programs.read",
    Ref,
    (p, _i, principal) => withdrawProgram(p, principal.userId),
    { author: true },
  );
  const remove = step(
    "programs.read",
    Ref,
    (p, _i, principal, now) => {
      assertDeletable(p, principal.userId);
      return { ...p, deletedAt: now };
    },
    { action: "DELETE", author: true },
  );
  const approve = step("programs.approve", Ref, (p, _i, principal, now) =>
    approveProgram(p, principal.userId, now),
  );
  const returnToProposal = step("programs.approve", WithNote, (p, i) => returnProgram(p, i.note));
  const cancel = step("programs.approve", WithNote, (p, i, _principal, now) =>
    cancelProgram(p, i.note, now),
  );
  const start = step("programs.read", Ref, (p, _i, _principal, now) => startProgram(p, now));
  const finish = createGuardedAction({
    permission: "programs.read",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, principal, audit) => {
      const now = deps.now();
      const { program, lpj } = await deps.programs.finish(
        id,
        version,
        managed(principal, (p) => finishProgram(p, now)),
        programAudit(audit, "UPDATE"),
        lpjAudit(audit, "CREATE"),
        now,
      );
      await deps.afterLpj(lpj);
      return {
        version: program.version,
        status: program.status,
        progress: program.progressPercent,
      };
    },
  });
  const health = step("programs.read", SetHealth, (p, i, principal, now) =>
    setHealth(p, i.health, i.reason, principal.userId, now),
  );
  const saveMilestone = step("programs.read", SaveMilestone, (p, i) => {
    const { title, dueOn, weight, sort } = i;
    return upsertMilestone(p, i.milestoneId ?? deps.uuid(), { title, dueOn, weight, sort });
  });
  const deleteMilestone = step("programs.read", MilestoneRef, (p, i) =>
    removeMilestone(p, i.milestoneId),
  );
  const markMilestone = step("programs.read", CompleteMilestone, (p, i, principal, now) =>
    completeMilestone(p, i.milestoneId, i.done, principal.userId, now),
  );

  const requestRevision = createGuardedAction({
    permission: "programs.read",
    input: RequestRevision,
    resource: scopeOf,
    handler: async ({ id, changes, reason }, principal, audit) => {
      const program = await deps.programs.get(id);
      if (!program || !canManageProgram(principal, program)) {
        throw new RuleViolationError("Only the programme's PICs or its unit can do this.");
      }
      if (
        changes.orgUnitId !== undefined &&
        !can(principal, "programs.edit", await unitScope(changes.orgUnitId))
      ) {
        throw new RuleViolationError("You can only plan programmes of your own unit.");
      }
      const saved = await deps.programs.requestRevision(
        id,
        changes,
        reason,
        principal.userId,
        revisionAudit(audit, "CREATE"),
        deps.now(),
      );
      return { id: saved.id };
    },
  });

  const decideRevision = createGuardedAction({
    permission: "programs.approve",
    input: DecideRevision,
    resource: async ({ id }) => ({
      orgUnitPath: (await deps.programs.getRevision(id))?.orgUnitPath ?? [],
    }),
    handler: async ({ id, verdict }, principal, audit) => {
      const { revision } = await deps.programs.decideRevision(
        id,
        verdict,
        principal.userId,
        programAudit(audit, "UPDATE"),
        revisionAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { status: revision.status };
    },
  });

  const checkIn = createGuardedAction({
    permission: "programs.read",
    input: CheckIn,
    resource: scopeOf,
    handler: async ({ id, ...report }, principal, audit) => {
      const program = await deps.programs.get(id);
      if (!program || !canManageProgram(principal, program)) {
        throw new RuleViolationError("Only the programme's PICs or its unit can do this.");
      }
      const now = deps.now();
      const saved = await deps.programs.checkIn(
        id,
        weekStartUtc(now),
        report,
        principal.userId,
        (before, after, current, checkin) =>
          audit({
            module: "programs",
            action: before ? "UPDATE" : "CREATE",
            resourceType: "checkin",
            resourceId: checkin.id,
            title: `${current.name} · ${checkin.weekStart}`,
            before,
            after,
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          }),
        now,
      );
      return { id: saved.id, weekStart: saved.weekStart };
    },
  });

  return {
    save,
    submit,
    withdraw,
    remove,
    requestRevision,
    decideRevision,
    approve,
    returnToProposal,
    cancel,
    start,
    finish,
    health,
    saveMilestone,
    deleteMilestone,
    markMilestone,
    checkIn,
  };
}
