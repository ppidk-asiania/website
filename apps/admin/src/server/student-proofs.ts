import "server-only";
import { z } from "zod";
import type { SqlApplicationStore, SqlMemberProfileStore } from "@website/db/sql";
import { PROOF_FILES, type ProofReview } from "@website/domain/members";
import { RuleViolationError } from "@website/domain/shared";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

export interface ProofDeps {
  readonly profiles: Pick<SqlMemberProfileStore, "findByUserId" | "updateProof">;
  readonly applications: Pick<SqlApplicationStore, "get">;
  readonly signedUrl: (path: string) => Promise<string>;
  readonly notify: (uid: string, review: ProofReview) => Promise<void>;
  readonly now: () => Date;
}

const Ref = z.object({ id: safeId });

/** Reviewing the student proof of an applicant (`recruitment.review`). */
export function createProofActions(deps: ProofDeps) {
  const ownerOf = async (id: string) => {
    const application = await deps.applications.get(id);
    if (!application) throw new RuleViolationError("This application does not exist.");
    return application.userId;
  };

  return {
    // The path comes from the applicant's stored profile, never from the request.
    fileUrl: createGuardedAction({
      permission: "recruitment.review",
      input: Ref.extend({ file: z.enum(PROOF_FILES) }).strict(),
      handler: async ({ id, file }) => {
        const proof = (await deps.profiles.findByUserId(await ownerOf(id)))?.studentProof;
        const stored = file === "main" ? proof?.main : proof?.supporting;
        if (!proof || !stored) throw new RuleViolationError("This file was not uploaded.");
        // the version makes a replaced file a new address, never served from a cache
        return { url: `${await deps.signedUrl(stored.path)}&v=${proof.uploadedAt.getTime()}` };
      },
    }),

    review: createGuardedAction({
      permission: "recruitment.review",
      input: Ref.extend({ state: z.enum(["ok", "fix"]), note: safeText(500, { allowEmpty: true }) })
        .strict()
        .refine((input) => input.state === "ok" || input.note.length > 0, {
          path: ["note"],
          message: "Tell the applicant what to fix.",
        }),
      handler: async ({ id, state, note }, principal, audit) => {
        const uid = await ownerOf(id);
        const review: ProofReview = { state, note, by: principal.userId, at: deps.now() };
        const result = await deps.profiles.updateProof(
          uid,
          (current) => {
            if (!current.studentProof) throw new RuleViolationError("No proof has been uploaded.");
            return { ...current, proofReview: review };
          },
          (before, after, profile) =>
            audit({
              module: "recruitment",
              action: "UPDATE",
              resourceType: "proof",
              resourceId: id,
              title: id,
              before: { proofReview: before.proofReview?.state ?? null },
              after: { proofReview: after.proofReview?.state ?? null, note },
              versionBefore: profile.version,
              versionAfter: profile.version,
              revertible: false,
            }),
        );
        if (!result) throw new RuleViolationError("This profile does not exist.");
        await deps.notify(uid, review);
        return { state };
      },
    }),
  };
}
