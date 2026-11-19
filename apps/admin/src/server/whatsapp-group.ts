import "server-only";
import { numberFromChatId } from "@website/domain/members";
import {
  groupAnswer,
  GROUP_HELP,
  GROUP_REFUSAL,
  hasInterviewScope,
  parseGroupKeyword,
  pickRecruitment,
  type InterviewScope,
  type Recruitment,
  type RecruitmentRecap,
} from "@website/domain/recruitment";
import { sha256Hex, type RateLimitStore } from "@website/security";
import type { IncomingMessage } from "./polls";

// shortcut: one limit per group, not per sender; split it if a busy group starves quiet members.
const ANSWERS = { perMinute: 20, perDay: 5_000, throttleDelayMs: 0 };

export interface GroupBotDeps {
  readonly record: (provider: string, eventId: string, now: Date) => Promise<boolean>;
  readonly recruitments: () => Promise<readonly Recruitment[]>;
  /** The account that verified this number (`whatsappVerifiedAt`), or null. */
  readonly senderUid: (number: string) => Promise<string | null>;
  readonly resolveLid: (lid: string) => Promise<string | null>;
  readonly scopeOf: (uid: string) => Promise<Pick<InterviewScope, "all" | "orgUnitIds">>;
  readonly recap: (
    ids: readonly string[],
    scope: Pick<InterviewScope, "all" | "orgUnitIds">,
  ) => Promise<RecruitmentRecap>;
  readonly rateLimits: RateLimitStore;
  readonly reply: (to: string, text: string, key: string) => Promise<unknown>;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

/**
 * Step 11.8: a signed WAHA `message` from the recruitment group. Only the keywords are answered, in
 * the scope of the VERIFIED sender (same rule as the recap page), as counts: never a number, e-mail
 * or score. The signature is checked by the webhook route before this runs.
 */
export function createGroupBot(deps: GroupBotDeps) {
  return async (message: IncomingMessage): Promise<void> => {
    const keyword = message.fromMe ? null : parseGroupKeyword(message.text);
    if (!keyword || !message.from.endsWith("@g.us")) return;
    try {
      const group = (await deps.recruitments()).filter((r) => r.waGroup?.id === message.from);
      const recruitment = pickRecruitment(group, deps.now());
      if (!recruitment) return; // not a configured group: stay silent
      const now = deps.now();
      const eventId = sha256Hex(new TextEncoder().encode(`group:${message.id}`));
      if (!(await deps.record("waha", eventId, now))) return;
      const limit = await deps.rateLimits.consume(
        `wagroup-${sha256Hex(new TextEncoder().encode(message.from)).slice(0, 32)}`,
        ANSWERS,
        now,
      );
      if (!limit.allowed) return;
      const say = (text: string) => deps.reply(message.from, text, `wagroup:${eventId}`);
      if (keyword === "bantuan") return void (await say(GROUP_HELP));

      const who = message.participant ?? "";
      const number = who.endsWith("@lid") ? await deps.resolveLid(who) : numberFromChatId(who);
      const uid = number ? await deps.senderUid(number) : null;
      const scope = uid ? await deps.scopeOf(uid) : null;
      if (!scope || !hasInterviewScope(scope)) return void (await say(GROUP_REFUSAL));
      const recap = await deps.recap([recruitment.id], scope);
      await say(groupAnswer(keyword, recruitment.title, recap));
    } catch (error) {
      deps.logError("whatsapp group answer failed", { error: String(error) });
    }
  };
}
