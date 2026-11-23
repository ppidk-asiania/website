import { PhoneE164Schema } from "./profile";

export const WHATSAPP_LINK_COMMAND = "/asiania";
export const WHATSAPP_LINK_TTL_MS = 30 * 60 * 1000;
export const WHATSAPP_LINK_PURPOSE = "whatsapp-link";

// No I, L, O, 0, 1: they look alike on a phone screen.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

export function newLinkCode(randomInt: (max: number) => number): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export const whatsappLinkText = (code: string) => `${WHATSAPP_LINK_COMMAND} ${code}`;

/** null: not a link message. `code` is null when the text after the command is not a code. */
export function parseLinkMessage(text: string): { readonly code: string | null } | null {
  const match = /^\/asiania\s+(\S.*)$/is.exec(text.trim());
  if (!match) return null;
  const code = (match[1] as string).trim().toUpperCase();
  return { code: CODE_PATTERN.test(code) ? code : null };
}

/** "628123@c.us" -> "+628123"; groups, LIDs and anything else -> null. */
export function numberFromChatId(chatId: string): string | null {
  const match = /^(\d+)@c\.us$/.exec(chatId);
  const parsed = PhoneE164Schema.safeParse(`+${match?.[1] ?? ""}`);
  return parsed.success ? parsed.data : null;
}
