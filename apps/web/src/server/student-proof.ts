import "server-only";
import { z } from "zod";
import type { SqlMemberProfileStore } from "@website/db/sql";
import {
  detectProofType,
  MAX_PROOF_BYTES,
  PROOF_CONTENT_TYPES,
  PROOF_FILES,
  reviewAfterUpload,
  studentProofPath,
} from "@website/domain/members";
import { RuleViolationError } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";

export interface StudentProofDeps {
  readonly profiles: Pick<SqlMemberProfileStore, "findByUserId" | "updateProof">;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/octet-stream" },
    ): Promise<unknown>;
    read(path: string, visibility: "private"): Promise<Uint8Array | null>;
    remove(path: string): Promise<void>;
  };
  readonly now: () => Date;
  readonly uuid: () => string;
}

export type ProofOwner = { readonly uid: string } | null;

const noStore = { "Cache-Control": "private, no-store" };
type Refusal = "invalid" | "confirm" | "too_large" | "not_file" | "profile" | "main_first";
const refused = (error: Refusal, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: noStore });

const Query = z.object({ file: z.enum(PROOF_FILES), confirmed: z.literal("1").optional() });

export function createOwnStudentProof(deps: StudentProofDeps) {
  async function summary(owner: ProofOwner) {
    const profile = owner ? await deps.profiles.findByUserId(owner.uid) : null;
    if (!profile) return null;
    const proof = profile.studentProof ?? null;
    return {
      main: proof !== null,
      supporting: Boolean(proof?.supporting),
      confirmedActive: proof?.confirmedActive ?? false,
      version: proof?.uploadedAt.getTime() ?? 0,
      review: profile.proofReview
        ? { state: profile.proofReview.state, note: profile.proofReview.note }
        : null,
    };
  }

  async function upload(owner: ProofOwner, request: Request): Promise<Response> {
    if (!owner) return jsonError("unauthenticated");
    const params = new URL(request.url).searchParams;
    const query = Query.safeParse({
      file: params.get("file"),
      confirmed: params.get("confirmed") ?? undefined,
    });
    if (!query.success) return refused("invalid");
    const { file, confirmed } = query.data;
    // a new main file says: "this document states my active status"
    if (file === "main" && !confirmed) return refused("confirm");
    if (!(await deps.profiles.findByUserId(owner.uid))) return refused("profile");
    const bytes = await readBodyLimited(request, MAX_PROOF_BYTES);
    if (bytes === null) return refused("too_large", 413);
    const type = detectProofType(bytes);
    if (!type) return refused("not_file");
    const path = studentProofPath(owner.uid, file, type, deps.uuid());
    await deps.storage.save(path, bytes, {
      visibility: "private",
      contentType: "application/octet-stream", // served by the file extension
    });
    const now = deps.now();
    try {
      const result = await deps.profiles.updateProof(owner.uid, (current) => {
        const saved = current.studentProof;
        if (file === "supporting" && !saved) {
          throw new RuleViolationError("Upload the main document first.");
        }
        const uploaded = { path, type };
        return {
          studentProof:
            file === "main"
              ? {
                  main: uploaded,
                  supporting: saved?.supporting ?? null,
                  confirmedActive: true,
                  uploadedAt: now,
                }
              : saved && { ...saved, supporting: uploaded, uploadedAt: now },
          proofReview: reviewAfterUpload(current.proofReview, file, now),
        };
      });
      if (!result) throw new RuleViolationError("No profile.");
      const old = result.before.studentProof;
      const replaced = file === "main" ? old?.main : old?.supporting;
      if (replaced && replaced.path !== path) await deps.storage.remove(replaced.path);
    } catch (error) {
      await deps.storage.remove(path);
      if (error instanceof RuleViolationError) {
        return refused(file === "supporting" ? "main_first" : "profile");
      }
      throw error;
    }
    return Response.json({ ok: true }, { status: 201, headers: noStore });
  }

  /** The owner's own file only: the path comes from the stored profile, never from the request. */
  async function view(owner: ProofOwner, file: string | null): Promise<Response> {
    if (!owner) return jsonError("unauthenticated");
    const kind = PROOF_FILES.find((f) => f === file);
    const proof = kind ? (await deps.profiles.findByUserId(owner.uid))?.studentProof : null;
    const stored = kind && proof ? (kind === "main" ? proof.main : proof.supporting) : null;
    const bytes = stored ? await deps.storage.read(stored.path, "private") : null;
    if (!stored || !bytes) return new Response(null, { status: 404, headers: noStore });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...noStore,
        "Content-Type": PROOF_CONTENT_TYPES[stored.type],
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return { summary, upload, view };
}
