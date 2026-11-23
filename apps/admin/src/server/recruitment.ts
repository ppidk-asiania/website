import "server-only";
import { z } from "zod";
import type { SqlRecruitmentStore } from "@website/db/sql";
import {
  RecruitmentInputSchema,
  RubricInputSchema,
  storableRubric,
  WaGroupSchema,
  type Recruitment,
} from "@website/domain/recruitment";
import type { Messenger } from "@website/domain/messaging";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface RecruitmentDeps {
  readonly recruitments: Pick<SqlRecruitmentStore, "get" | "save" | "write">;
  readonly send: Messenger["send"];
  readonly now: () => Date;
}

const SaveInput = RecruitmentInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "DELETE" | "PUBLISH" | "UNPUBLISH";

const recruitmentAudit =
  (audit: AuditBuilder, action: Action) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Recruitment | null,
    next: Recruitment,
  ) =>
    audit({
      module: "recruitment",
      action,
      resourceType: "recruitment",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: action === "CREATE" || action === "DELETE",
    });

export function createRecruitmentActions(deps: RecruitmentDeps) {
  const save = createGuardedAction({
    permission: "recruitment.edit",
    input: SaveInput,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.recruitments.save(
        id ?? null,
        version,
        input,
        (before, after, current, next) =>
          recruitmentAudit(audit, current ? "UPDATE" : "CREATE")(before, after, current, next),
        deps.now(),
      );
      return { id: saved.id, version: saved.version, formVersion: saved.formVersion };
    },
  });

  const setPublished = createGuardedAction({
    permission: "recruitment.edit",
    input: RefInput.extend({ published: z.boolean() }).strict(),
    handler: async ({ id, version, published }, _principal, audit) => {
      const saved = await deps.recruitments.write(
        id,
        version,
        (current) => ({ ...(current as Recruitment), published }),
        recruitmentAudit(audit, published ? "PUBLISH" : "UNPUBLISH"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  /** The committee edits the interview rubric (step 11.6); the default is stored as empty. */
  const saveRubric = createGuardedAction({
    permission: "recruitment.edit",
    input: RefInput.extend({ rubric: RubricInputSchema }).strict(),
    handler: async ({ id, version, rubric }, _principal, audit) => {
      const saved = await deps.recruitments.write(
        id,
        version,
        (current) => ({ ...(current as Recruitment), interviewRubric: storableRubric(rubric) }),
        recruitmentAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  /** The committee pastes the WhatsApp group id (step 11.8); null removes the group. */
  const saveWaGroup = createGuardedAction({
    permission: "recruitment.edit",
    input: RefInput.extend({ group: WaGroupSchema.nullable() }).strict(),
    handler: async ({ id, version, group }, _principal, audit) => {
      const saved = await deps.recruitments.write(
        id,
        version,
        (current) => ({ ...(current as Recruitment), waGroup: group }),
        recruitmentAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  /** "Send test message": one plain line to the saved group, so the committee sees it works. */
  const testWaGroup = createGuardedAction({
    permission: "recruitment.edit",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }) => {
      const group = (await deps.recruitments.get(id))?.waGroup;
      if (!group) throw new RuleViolationError("Save the WhatsApp group first.");
      const status = await deps.send(
        {
          channel: "whatsapp",
          to: group.id,
          subject: "",
          text: "Tes dari PPIDK: grup ini akan menerima kabar lamaran dan menjawab perintah seperti /rekap. / Test from PPIDK: this group will get application notices and answer commands like /rekap.",
          html: "",
        },
        `wagroup-test:${id}:${deps.now().getTime()}`,
      );
      return { status };
    },
  });

  const remove = createGuardedAction({
    permission: "recruitment.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.recruitments.write(
        id,
        version,
        (current) => ({ ...(current as Recruitment), published: false, deletedAt: now }),
        recruitmentAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  return { save, setPublished, saveRubric, saveWaGroup, testWaGroup, remove };
}
