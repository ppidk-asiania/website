import { z } from "zod";
import { safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";
import { isUnderway, ProgramInputSchema, type Program, type RevisionChanges } from "./programs";

export const REVISION_STATUSES = ["pending", "approved", "rejected"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const RevisionReasonSchema = safeText(1000, { multiline: true }).pipe(
  z.string().min(1, "Say why the plan must change."),
);

/** `programRevisions/{id}`: a request to change the locked plan of an approved programme. */
export interface ProgramRevision {
  readonly id: string;
  readonly programId: string;
  readonly periodId: string;
  readonly orgUnitPath: readonly string[];
  readonly changes: RevisionChanges;
  readonly reason: string;
  readonly requestedBy: string;
  readonly status: RevisionStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};

export function assertCanRevise(program: Pick<Program, "status">): void {
  if (!isUnderway(program.status)) {
    refuse("Only an approved or running programme needs a revision; edit the plan otherwise.");
  }
}

/** The programme with the revision applied; the result is checked like a new plan. */
export function applyRevision(program: Program, changes: RevisionChanges): Program {
  const { name, goal, description, orgUnitId, keyResultIds, plannedStart, plannedEnd, budgets } =
    program;
  const plan = ProgramInputSchema.safeParse({
    ...{ name, goal, description, orgUnitId, keyResultIds, plannedStart, plannedEnd, budgets },
    ...changes,
  });
  if (!plan.success) return refuse(plan.error.issues[0]?.message ?? "The revised plan is invalid.");
  return { ...program, ...plan.data };
}

export function decideRevision(
  revision: ProgramRevision,
  program: Program,
  verdict: "approved" | "rejected",
  uid: string,
  now: Date,
): { revision: ProgramRevision; program: Program } {
  if (revision.status !== "pending") refuse("This revision is already decided.");
  if (revision.requestedBy === uid) refuse("Someone else must decide your revision.");
  let next = program;
  if (verdict === "approved") {
    assertCanRevise(program);
    next = applyRevision(program, revision.changes);
  }
  return {
    revision: { ...revision, status: verdict, decidedBy: uid, decidedAt: now, updatedAt: now },
    program: next,
  };
}
