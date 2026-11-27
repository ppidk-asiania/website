import "server-only";
import { z } from "zod";
import type {
  OpportunityApplicationAudit,
  SqlOpportunityApplicationStore,
  SqlOpportunityStore,
} from "@website/db/sql";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@website/domain/opportunities";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal, type ResourceContext } from "@website/permissions";
import { jsonError } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface OpportunityApplicationDeps {
  readonly opportunities: Pick<SqlOpportunityStore, "get">;
  readonly applications: Pick<SqlOpportunityApplicationStore, "get" | "review" | "remove">;
  readonly storage: {
    signedReadUrl(path: string): Promise<string>;
    remove(path: string): Promise<void>;
  };
  readonly notify: {
    applicationStatus(
      userId: string,
      application: { id: string; opportunityId: string },
      title: string,
      status: ApplicationStatus,
    ): Promise<void>;
  };
  readonly now: () => Date;
}

const noStore = { "Cache-Control": "private, no-store" };
const Ref = z.object({ id: safeId }).strict();
const Review = Ref.extend({
  status: z.enum(APPLICATION_STATUSES).nullable(),
  note: safeText(500, { multiline: true, allowEmpty: true }),
}).strict();

const applicationAudit =
  (audit: AuditBuilder, title: string, action: "UPDATE" | "DELETE"): OpportunityApplicationAudit =>
  (before, after, application) =>
    audit({
      module: "opportunities",
      action,
      resourceType: "opportunityApplication",
      resourceId: application.id,
      title,
      before,
      after,
      versionBefore: null,
      versionAfter: null,
      revertible: false,
    });

/** Applicants of a posting: the posting's scope decides who may review (a chapter's, or the region's). */
export function createOpportunityApplicationActions(deps: OpportunityApplicationDeps) {
  const postingOf = async (id: string) => {
    const application = await deps.applications.get(id);
    const posting = application && (await deps.opportunities.get(application.opportunityId));
    if (!application || !posting) throw new RuleViolationError("This application does not exist.");
    return { application, posting };
  };
  const scopeOfApplication = async ({ id }: { id: string }): Promise<ResourceContext> => {
    const { posting } = await postingOf(id);
    return posting.chapterId ? { chapterId: posting.chapterId } : {};
  };

  const review = createGuardedAction({
    permission: "opportunities.edit",
    input: Review,
    resource: scopeOfApplication,
    handler: async ({ id, status, note }, _principal, audit) => {
      const { posting } = await postingOf(id);
      const { before, after } = await deps.applications.review(
        id,
        { status, note },
        deps.now(),
        applicationAudit(audit, `Application: ${posting.title}`, "UPDATE"),
      );
      if (after.status !== before.status) {
        await deps.notify.applicationStatus(after.userId, after, posting.title, after.status);
      }
      return { id };
    },
  });

  const remove = createGuardedAction({
    permission: "opportunities.edit",
    input: Ref,
    resource: scopeOfApplication,
    handler: async ({ id }, _principal, audit) => {
      const { posting } = await postingOf(id);
      const gone = await deps.applications.remove(
        id,
        applicationAudit(audit, `Application deleted: ${posting.title}`, "DELETE"),
      );
      // shortcut: a CV file whose removal fails stays on disk, an expire sweep would clean it.
      await deps.storage.remove(gone.cvPath).catch(() => undefined);
      return { id };
    },
  });

  /** A staff member of the posting opens the CV: a short-lived link to the private file. */
  const openCv = async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    const found = safeId.safeParse(id).success ? await deps.applications.get(id) : null;
    const posting = found && (await deps.opportunities.get(found.opportunityId));
    if (!found || !posting) {
      return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    }
    if (
      !can(
        principal,
        "opportunities.edit",
        posting.chapterId ? { chapterId: posting.chapterId } : {},
      )
    ) {
      return jsonError("forbidden");
    }
    return new Response(null, {
      status: 302,
      headers: { Location: await deps.storage.signedReadUrl(found.cvPath), ...noStore },
    });
  };

  return { review, remove, openCv };
}
