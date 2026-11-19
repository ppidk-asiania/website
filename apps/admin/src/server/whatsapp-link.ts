import "server-only";
import type { SqlMemberProfileStore } from "@website/db/sql";
import { numberFromChatId, parseLinkMessage } from "@website/domain/members";
import { sha256Hex } from "@website/security";
import type { IncomingMessage } from "./polls";

// Indonesian, then English. Never repeats the code.
const REPLY = {
  ok: "Nomor WhatsApp Anda sudah tertaut ke akun PPIDK. / Your WhatsApp number is now linked to your PPIDK account.",
  invalid:
    "Kode tidak valid atau sudah kedaluwarsa. Buat kode baru di halaman profil. / The code is invalid or expired. Create a new one on your profile page.",
  taken:
    "Nomor ini sudah tertaut ke akun lain. Hubungi sekretariat. / This number is already linked to another account. Contact the secretariat.",
} as const;

export interface WhatsappLinkingDeps {
  readonly record: (provider: string, eventId: string, now: Date) => Promise<boolean>;
  readonly profiles: Pick<SqlMemberProfileStore, "linkWhatsapp">;
  readonly hash: (code: string) => string;
  readonly resolveLid: (lid: string) => Promise<string | null>;
  readonly reply: (to: string, text: string, key: string) => Promise<unknown>;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

/** Handles a signed WAHA `message` event: "/asiania CODE" from a private chat links the sender. */
export function createWhatsappLinking(deps: WhatsappLinkingDeps) {
  return async (message: IncomingMessage): Promise<void> => {
    const command = message.fromMe ? null : parseLinkMessage(message.text);
    if (!command) return;
    const lid = message.from.endsWith("@lid");
    const number = lid ? await deps.resolveLid(message.from) : numberFromChatId(message.from);
    if (!number) {
      // Groups and other chats are ignored; only a LID WAHA cannot resolve is worth a log line.
      if (lid) deps.logError("whatsapp link: sender not resolved", {});
      return;
    }
    const now = deps.now();
    const eventId = sha256Hex(new TextEncoder().encode(`message:${message.id}`));
    if (!(await deps.record("waha", eventId, now))) return;
    const outcome = command.code
      ? await deps.profiles.linkWhatsapp(deps.hash(command.code), number, now)
      : ({ ok: false, reason: "invalid" } as const);
    await deps.reply(number, REPLY[outcome.ok ? "ok" : outcome.reason], `whatsapp-link:${eventId}`);
  };
}
