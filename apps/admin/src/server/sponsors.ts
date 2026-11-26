import "server-only";
import { z } from "zod";
import type { SqlSponsorStore } from "@website/db/sql";
import { DirectorySponsorInputSchema, type DirectorySponsor } from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface SponsorDeps {
  readonly sponsors: Pick<SqlSponsorStore, "write" | "activePeriodId">;
  readonly now: () => Date;
}

const SaveInput = DirectorySponsorInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "PUBLISH" | "UNPUBLISH" | "DELETE";

const sponsorAudit =
  (audit: AuditBuilder, action: Action) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: DirectorySponsor | null,
    next: DirectorySponsor,
  ) =>
    audit({
      module: "sponsors",
      action,
      resourceType: "sponsor",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

export function createSponsorActions(deps: SponsorDeps) {
  const save = createGuardedAction({
    permission: "sponsors.edit",
    input: SaveInput,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      // A new sponsor belongs to the active board period; an existing one keeps its own.
      const activeId = id ? null : await deps.sponsors.activePeriodId();
      if (!id && !activeId) throw new RuleViolationError("Activate a board period first.");
      let action: Action = "CREATE";
      const saved = await deps.sponsors.write(
        id ?? null,
        version,
        (current) => {
          if (current) {
            action =
              input.published !== current.published
                ? input.published
                  ? "PUBLISH"
                  : "UNPUBLISH"
                : "UPDATE";
          }
          return { ...input, periodId: current?.periodId ?? (activeId as string), deletedAt: null };
        },
        (before, after, current, next) => sponsorAudit(audit, action)(before, after, current, next),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "sponsors.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.sponsors.write(
        id,
        version,
        (current) => ({ ...(current as DirectorySponsor), deletedAt: now }),
        sponsorAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  return { save, remove };
}
