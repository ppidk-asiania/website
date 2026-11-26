import "server-only";
import type { SqlEventReader, SqlRegistrationStore } from "@website/db/sql";
import { detectProofType, MAX_PROOF_BYTES } from "@website/domain/members";
import { RuleViolationError } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";

export interface EventProofDeps {
  readonly events: Pick<SqlEventReader, "findPaymentGuide">;
  readonly registrations: Pick<SqlRegistrationStore, "submitProof">;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/octet-stream" },
    ): Promise<unknown>;
    remove(path: string): Promise<void>;
  };
  readonly now: () => Date;
  readonly uuid: () => string;
}

const noStore = { "Cache-Control": "private, no-store" };
type Refusal = "no_event" | "too_large" | "not_file" | "no_payment";
const refused = (error: Refusal, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: noStore });

/** The participant sends the proof of a payment made outside the platform (DEC-26): private, image or PDF. */
export function createEventProofUpload(deps: EventProofDeps) {
  return async (
    owner: { readonly uid: string } | null,
    slug: string,
    request: Request,
  ): Promise<Response> => {
    if (!owner) return jsonError("unauthenticated");
    const guide = await deps.events.findPaymentGuide(slug, deps.now());
    if (!guide) return refused("no_event", 404);
    const bytes = await readBodyLimited(request, MAX_PROOF_BYTES);
    if (bytes === null) return refused("too_large", 413);
    const type = detectProofType(bytes);
    if (!type) return refused("not_file");
    const path = `events/proofs/${guide.event.id}/${owner.uid}_${deps.uuid().replace(/-/g, "").slice(0, 8)}.${type === "jpeg" ? "jpg" : type}`;
    await deps.storage.save(path, bytes, {
      visibility: "private",
      contentType: "application/octet-stream", // served by the file extension
    });
    try {
      const { replaced } = await deps.registrations.submitProof(
        guide.event.id,
        owner.uid,
        { path, type },
        deps.now(),
      );
      if (replaced && replaced !== path) await deps.storage.remove(replaced);
    } catch (error) {
      await deps.storage.remove(path);
      if (error instanceof RuleViolationError) return refused("no_payment");
      throw error;
    }
    return Response.json({ ok: true }, { status: 201, headers: noStore });
  };
}
