import "server-only";
import { numberFromChatId } from "@website/domain/members";
import { whatsappChatId, type WahaConfig } from "@website/email";

export { wahaChannel, whatsappChatId, whatsappText, type WahaConfig } from "@website/email";

export function wahaPoll(config: WahaConfig | null, fetchImpl: typeof fetch = fetch) {
  return async (
    e164: string,
    question: string,
    options: readonly string[],
  ): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> => {
    if (!config) return { ok: false, error: "not_configured" };
    try {
      const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/api/sendPoll`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
        body: JSON.stringify({
          session: config.session,
          chatId: whatsappChatId(e164),
          poll: { name: question, options, multipleAnswers: false },
        }),
      });
      if (!response.ok) return { ok: false, error: `waha_${response.status}` };
      const body = (await response.json().catch(() => ({}))) as {
        id?: string | { _serialized?: string };
      };
      const id = typeof body.id === "string" ? body.id : (body.id?._serialized ?? "");
      return id ? { ok: true, messageId: id } : { ok: false, error: "waha_no_id" };
    } catch {
      return { ok: false, error: "waha_unreachable" };
    }
  };
}

/** WhatsApp may hide a sender behind a LID; WAHA maps it back to the phone number (E.164) or null. */
export function wahaResolveLid(config: WahaConfig | null, fetchImpl: typeof fetch = fetch) {
  return async (lid: string): Promise<string | null> => {
    if (!config) return null;
    try {
      const base = config.baseUrl.replace(/\/+$/, "");
      const response = await fetchImpl(
        `${base}/api/${encodeURIComponent(config.session)}/lids/${encodeURIComponent(lid)}`,
        { signal: AbortSignal.timeout(10_000), headers: { "X-Api-Key": config.apiKey } },
      );
      if (!response.ok) return null;
      const body = (await response.json().catch(() => ({}))) as { pn?: unknown };
      return typeof body.pn === "string" ? numberFromChatId(body.pn) : null;
    } catch {
      return null;
    }
  };
}
