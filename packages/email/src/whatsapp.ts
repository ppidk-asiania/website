export interface WahaConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly session: string;
}

/** A person (E.164) becomes `…@c.us`; a group id (`…@g.us`, step 11.8) is used as it is. */
export const whatsappChatId = (to: string) =>
  to.includes("@") ? to : `${to.replace(/^\+/, "")}@c.us`;

export const whatsappText = (message: { readonly subject: string; readonly text: string }) =>
  message.subject ? `*${message.subject}*\n\n${message.text}` : message.text;

interface WhatsappMessage {
  readonly to: string | null;
  readonly subject: string;
  readonly text: string;
  readonly mentions?: readonly string[];
}

/** Plain text to one person or one group; `mentions` are appended as `@number` so WhatsApp shows names. */
export function wahaChannel(config: WahaConfig | null, fetchImpl: typeof fetch = fetch) {
  return {
    async send(
      message: WhatsappMessage,
      _key: string,
    ): Promise<{ ok: true; providerId: string } | { ok: false; error: string }> {
      if (!config || !message.to) return { ok: false, error: "not_configured" };
      const mentions = (message.mentions ?? []).map(whatsappChatId);
      const text = [whatsappText(message), mentions.map((m) => `@${m.split("@")[0]}`).join(" ")]
        .filter(Boolean)
        .join("\n");
      try {
        const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/api/sendText`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
          body: JSON.stringify({
            session: config.session,
            chatId: whatsappChatId(message.to),
            text,
            ...(mentions.length > 0 ? { mentions } : {}),
          }),
        });
        if (!response.ok) return { ok: false, error: `waha_${response.status}` };
        const body = (await response.json().catch(() => ({}))) as {
          id?: string | { _serialized?: string };
        };
        const id = typeof body.id === "string" ? body.id : (body.id?._serialized ?? "");
        return { ok: true, providerId: id };
      } catch {
        return { ok: false, error: "waha_unreachable" };
      }
    },
  };
}
