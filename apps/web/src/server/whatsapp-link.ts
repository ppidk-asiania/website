import "server-only";
import type { SqlMemberProfileStore } from "@website/db/sql";
import { newLinkCode, whatsappLinkText } from "@website/domain/members";
import type { ProfileOwner } from "./profile";

export interface WhatsappLinkDeps {
  readonly profiles: Pick<SqlMemberProfileStore, "issueWhatsappCode">;
  readonly hash: (code: string) => string;
  readonly randomInt: (max: number) => number;
  readonly botNumber: string | null;
  readonly now: () => Date;
}

export type WhatsappLinkResult =
  | {
      ok: true;
      code: string;
      text: string;
      url: string;
      expiresAt: string;
    }
  | { ok: false; error: "signin" | "not_configured" | "profile" };

export function createWhatsappLink(deps: WhatsappLinkDeps) {
  return {
    /** A new code for the signed-in member; the old one stops working. */
    async issue(owner: ProfileOwner | null): Promise<WhatsappLinkResult> {
      if (!owner) return { ok: false, error: "signin" };
      if (!deps.botNumber) return { ok: false, error: "not_configured" };
      const code = newLinkCode(deps.randomInt);
      const expiresAt = await deps.profiles.issueWhatsappCode(
        owner.uid,
        deps.hash(code),
        deps.now(),
      );
      if (!expiresAt) return { ok: false, error: "profile" };
      const text = whatsappLinkText(code);
      return {
        ok: true,
        code,
        text,
        url: `https://wa.me/${deps.botNumber.slice(1)}?text=${encodeURIComponent(text)}`,
        expiresAt: expiresAt.toISOString(),
      };
    },
  };
}
