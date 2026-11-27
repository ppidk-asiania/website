import "server-only";
import type { SqlOpportunityApplicationWebStore } from "@website/db/sql";
import { ApplicationInputSchema, applicationId } from "@website/domain/opportunities";
import { MAX_PROOF_BYTES } from "@website/domain/members";
import type { Message } from "@website/domain/messaging";
import { isPdf, RuleViolationError } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";
import { safeId } from "@website/security/validation";

export interface OpportunityApplicationRequestDeps {
  readonly applications: Pick<SqlOpportunityApplicationWebStore, "apply">;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/octet-stream" },
    ): Promise<unknown>;
    remove(path: string): Promise<void>;
  };
  readonly send: (message: Message, key: string) => Promise<unknown>;
  readonly profileComplete: (userId: string) => Promise<boolean>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

type User = { readonly uid: string; readonly email: string | null } | null;
type Refusal = "invalid" | "profile" | "too_large" | "not_pdf" | "unavailable";

const noStore = { "Cache-Control": "private, no-store" };
const refused = (error: Refusal, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: noStore });

/** Room for the cover letter and the form's framing around the CV. */
const FORM_OVERHEAD = 64 * 1024;

const RECEIVED: readonly [string, string] = [
  "Lamaranmu sudah kami terima. Kami akan menghubungimu lewat akunmu.",
  "We received your application. We will get back to you through your account.",
];

/** An application made on the platform (N6.2): a member with a complete profile, a cover letter and a CV (PDF). */
export function createOpportunityApplications(deps: OpportunityApplicationRequestDeps) {
  const apply = async (user: User, opportunityId: string, request: Request): Promise<Response> => {
    if (!user) return jsonError("unauthenticated");
    if (!safeId.safeParse(opportunityId).success) return refused("invalid");
    const bytes = await readBodyLimited(request, MAX_PROOF_BYTES + FORM_OVERHEAD);
    if (bytes === null) return refused("too_large", 413);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(bytes), {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      return refused("invalid");
    }
    const letter = ApplicationInputSchema.safeParse({ coverLetter: form.get("coverLetter") });
    const cv = form.get("cv");
    if (!letter.success || !(cv instanceof File)) return refused("invalid");
    if (cv.size > MAX_PROOF_BYTES) return refused("too_large", 413);
    const file = new Uint8Array(await cv.arrayBuffer());
    if (!isPdf(file)) return refused("not_pdf");
    if (!(await deps.profileComplete(user.uid))) return refused("profile", 403);

    // A new name per try: a refused second attempt must never touch the first CV.
    const path = `opportunities/cv/${applicationId(opportunityId, user.uid)}_${deps.uuid()}.pdf`;
    await deps.storage.save(path, file, {
      visibility: "private",
      contentType: "application/octet-stream", // served by the file extension
    });
    try {
      await deps.applications.apply(
        opportunityId,
        user.uid,
        { coverLetter: letter.data.coverLetter, cvPath: path },
        deps.now(),
        deps.now().toISOString().slice(0, 10),
      );
    } catch (error) {
      await deps.storage.remove(path);
      if (error instanceof RuleViolationError) return refused("unavailable", 409);
      throw error;
    }
    if (user.email) {
      await deps.send(
        {
          channel: "email",
          to: user.email,
          subject: "Lamaran diterima / Application received",
          text: `${RECEIVED[0]}\n\n${RECEIVED[1]}`,
          html: `<p>${RECEIVED[0]}</p><p>${RECEIVED[1]}</p>`,
        },
        `opportunity:${applicationId(opportunityId, user.uid)}:received`,
      );
    }
    return Response.json({ ok: true }, { status: 201, headers: noStore });
  };

  return { apply };
}
