import "server-only";
import { z } from "zod";
import type { SqlOpportunityStore } from "@website/db/sql";
import {
  OPPORTUNITY_STATUSES,
  OpportunityInputSchema,
  type Opportunity,
} from "@website/domain/opportunities";
import { RuleViolationError } from "@website/domain/shared";
import type { ResourceContext } from "@website/permissions";
import { sanitizeRichText } from "@website/security/html";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface OpportunityDeps {
  readonly opportunities: Pick<SqlOpportunityStore, "get" | "write" | "setMentorshipForm">;
  /** An account form (public, answered while signed in) that exists. */
  readonly isAccountForm: (formId: string) => Promise<boolean>;
  readonly chapterExists: (chapterId: string) => Promise<boolean>;
  readonly now: () => Date;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
/** A posting keeps the chapter it was made for; only the fields below can change. */
const Update = OpportunityInputSchema.omit({ chapterId: true })
  .extend({ id: safeId, version: z.number().int().min(1) })
  .strict();
const SetStatus = Ref.extend({ status: z.enum(OPPORTUNITY_STATUSES) }).strict();

type Action = "CREATE" | "UPDATE" | "DELETE";

const opportunityAudit =
  (audit: AuditBuilder, action: Action) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Opportunity | null,
    next: Opportunity,
  ) =>
    audit({
      module: "opportunities",
      action,
      resourceType: "opportunity",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

export function createOpportunityActions(deps: OpportunityDeps) {
  /** The scope of a stored posting: its chapter, or the whole region. A missing one reads as forbidden. */
  const scopeOfId = async ({ id }: { id: string }): Promise<ResourceContext> => {
    const found = await deps.opportunities.get(id);
    if (!found) throw new RuleViolationError("This posting does not exist.");
    return found.chapterId ? { chapterId: found.chapterId } : {};
  };

  const create = createGuardedAction({
    permission: "opportunities.edit",
    input: OpportunityInputSchema,
    resource: ({ chapterId }): ResourceContext => (chapterId ? { chapterId } : {}),
    handler: async ({ description, requirements, ...input }, principal, audit) => {
      if (input.chapterId && !(await deps.chapterExists(input.chapterId))) {
        throw new RuleViolationError("This chapter does not exist.");
      }
      const saved = await deps.opportunities.write(
        null,
        null,
        () => ({
          ...input,
          description: sanitizeRichText(description),
          requirements: sanitizeRichText(requirements),
          postedBy: principal.userId,
          deletedAt: null,
        }),
        opportunityAudit(audit, "CREATE"),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const update = createGuardedAction({
    permission: "opportunities.edit",
    input: Update,
    resource: scopeOfId,
    handler: async ({ id, version, description, requirements, ...input }, _principal, audit) => {
      const saved = await deps.opportunities.write(
        id,
        version,
        (current) => ({
          ...(current as Opportunity),
          ...input,
          description: sanitizeRichText(description),
          requirements: sanitizeRichText(requirements),
        }),
        opportunityAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const setStatus = createGuardedAction({
    permission: "opportunities.edit",
    input: SetStatus,
    resource: scopeOfId,
    handler: async ({ id, version, status }, _principal, audit) => {
      const saved = await deps.opportunities.write(
        id,
        version,
        (current) => ({ ...(current as Opportunity), status }),
        opportunityAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "opportunities.edit",
    input: Ref,
    resource: scopeOfId,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.opportunities.write(
        id,
        version,
        (current) => ({ ...(current as Opportunity), deletedAt: now }),
        opportunityAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  /** The mentorship sign-up is one account form chosen here; the board links to it. Region-wide: global holders only. */
  const setMentorshipForm = createGuardedAction({
    permission: "opportunities.edit",
    input: z.object({ formId: safeId.nullable() }).strict(),
    handler: async ({ formId }, _principal, audit) => {
      if (formId !== null && !(await deps.isAccountForm(formId))) {
        throw new RuleViolationError("Choose a form that people answer while signed in.");
      }
      await deps.opportunities.setMentorshipForm(formId, (before, after) =>
        audit({
          module: "opportunities",
          action: "UPDATE",
          resourceType: "opportunitySettings",
          resourceId: "opportunities",
          title: "Mentorship form",
          before,
          after,
          versionBefore: null,
          versionAfter: null,
          revertible: false,
        }),
      );
      return { formId };
    },
  });

  return { create, update, setStatus, remove, setMentorshipForm };
}
