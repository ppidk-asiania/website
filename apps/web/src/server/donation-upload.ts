import "server-only";
import type { SqlDonationWebStore } from "@website/db/sql";
import { DonationInputSchema } from "@website/domain/organizations";
import { detectProofType, MAX_PROOF_BYTES } from "@website/domain/members";
import type { Message } from "@website/domain/messaging";
import { RuleViolationError, toMinor } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";

export interface DonationUploadDeps {
  readonly donations: Pick<SqlDonationWebStore, "channel" | "submit">;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/octet-stream" },
    ): Promise<unknown>;
    remove(path: string): Promise<void>;
  };
  readonly send: (message: Message, key: string) => Promise<unknown>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const noStore = { "Cache-Control": "private, no-store" };
type Refusal = "no_channel" | "invalid" | "amount" | "too_large" | "not_file";
const refused = (error: Refusal, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: noStore });

/**
 * A donation sent with its proof (DEC-26): the fields travel in the query string, the file is the body
 * (as for the event proof). The donation waits as `pending` until a treasurer checks it.
 */
export function createDonationUpload(deps: DonationUploadDeps) {
  return async (
    owner: {
      readonly uid: string;
      readonly email: string | null;
      readonly name?: string | null;
    } | null,
    request: Request,
  ): Promise<Response> => {
    if (!owner) return jsonError("unauthenticated");
    const query = new URL(request.url).searchParams;
    const channelId = query.get("channel") ?? "";
    const channel = await deps.donations.channel(channelId).catch(() => null);
    if (!channel) return refused("no_channel", 404);
    const amountMinor = toMinor(query.get("amount") ?? "", channel.currency);
    if (amountMinor === null) return refused("amount");
    const parsed = DonationInputSchema.safeParse({
      channelId,
      amountMinor,
      message: query.get("message") ?? "",
      showName: query.get("name") === "1",
    });
    if (!parsed.success) return refused("invalid");
    const bytes = await readBodyLimited(request, MAX_PROOF_BYTES);
    if (bytes === null) return refused("too_large", 413);
    const type = detectProofType(bytes);
    if (!type) return refused("not_file");
    const id = deps.uuid();
    const path = `donations/proofs/${id}.${type === "jpeg" ? "jpg" : type}`;
    await deps.storage.save(path, bytes, {
      visibility: "private",
      contentType: "application/octet-stream", // served by the file extension
    });
    try {
      await deps.donations.submit(
        id,
        owner.uid,
        parsed.data,
        owner.name?.trim() || null,
        { path, type },
        deps.now(),
      );
    } catch (error) {
      await deps.storage.remove(path);
      if (error instanceof RuleViolationError) return refused("no_channel", 404);
      throw error;
    }
    if (owner.email) {
      await deps.send(
        {
          channel: "email",
          to: owner.email,
          subject: "Donasi diterima / Donation received",
          text: "Terima kasih. Donasimu menunggu pemeriksaan; kami akan memberi kabar.\n\nThank you. Your donation is waiting to be checked; we will let you know.",
          html: "<p>Terima kasih. Donasimu menunggu pemeriksaan; kami akan memberi kabar.</p><p>Thank you. Your donation is waiting to be checked; we will let you know.</p>",
        },
        `donation:${id}:received`,
      );
    }
    return Response.json({ ok: true }, { status: 201, headers: noStore });
  };
}
