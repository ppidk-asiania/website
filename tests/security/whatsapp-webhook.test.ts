import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlMemberProfileStore, createSqlWebhookEventStore } from "@website/db/sql";
import { WHATSAPP_LINK_PURPOSE, WHATSAPP_LINK_TTL_MS } from "@website/domain/members";
import { keyedHash } from "@website/security";
import { createWahaWebhookRoute } from "../../apps/admin/src/server/polls";
import { createWhatsappLinking } from "../../apps/admin/src/server/whatsapp-link";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMemberProfileStore>[0];
const now = new Date("2026-11-16T05:00:00Z");
const SECRET = "waha-webhook-secret-123";
const HASH_SECRET = "h".repeat(32);
const CODE = "ABCD2345";
const SENDER = "6281234567890@c.us";

function setup(secret: string | undefined = SECRET) {
  const fake = fakeDb();
  const profiles = createSqlMemberProfileStore(fake.db as unknown as Db);
  const replies: string[] = [];
  const codeHash = keyedHash(WHATSAPP_LINK_PURPOSE, CODE, HASH_SECRET);
  fake.docs.set("memberProfiles/siti", { fullName: "Siti", whatsappNumber: "+6280000000000" });
  fake.docs.set(`whatsappLinkCodes/${codeHash}`, {
    uid: "siti",
    createdAt: now,
    expiresAt: new Date(now.getTime() + WHATSAPP_LINK_TTL_MS),
  });
  const route = createWahaWebhookRoute({
    secret,
    record: (provider, id, at) =>
      createSqlWebhookEventStore(fake.db as unknown as Db).record(provider, id, at),
    surveys: { vote: () => Promise.resolve(false) },
    onMessage: createWhatsappLinking({
      record: () => Promise.resolve(true),
      profiles,
      hash: (code) => keyedHash(WHATSAPP_LINK_PURPOSE, code, HASH_SECRET),
      resolveLid: () => Promise.resolve(null),
      reply: (to, text) => Promise.resolve(replies.push(`${to}:${text}`)),
      logError: () => undefined,
      now: () => now,
    }),
    now: () => now,
  });
  const body = JSON.stringify({
    event: "message",
    payload: { id: "m1", from: SENDER, fromMe: false, body: `/asiania ${CODE}` },
  });
  const request = (headers: Record<string, string>, text = body) =>
    new Request("https://admin.example.org/webhooks/waha", {
      method: "POST",
      headers,
      body: text,
    });
  const sign = (secretKey: string, text = body) =>
    createHmac("sha512", secretKey).update(text).digest("hex");
  const untouched = () => {
    expect(fake.docs.get("memberProfiles/siti")).toEqual({
      fullName: "Siti",
      whatsappNumber: "+6280000000000",
    });
    expect(fake.docs.has(`whatsappLinkCodes/${codeHash}`)).toBe(true);
  };
  return { fake, route, request, sign, replies, untouched };
}

describe("WhatsApp link webhook: only a signed request can link a number", () => {
  it("links nothing without a signature", async () => {
    const t = setup();
    expect((await t.route(t.request({}))).status).toBe(401);
    t.untouched();
    expect(t.replies).toEqual([]);
  });

  it("links nothing with a bad signature", async () => {
    const t = setup();
    expect(
      (await t.route(t.request({ "x-webhook-hmac": t.sign("another-secret-0000") }))).status,
    ).toBe(401);
    expect((await t.route(t.request({ "x-webhook-hmac": "zz" }))).status).toBe(401);
    const other = JSON.stringify({ event: "message", payload: { id: "m2" } });
    expect((await t.route(t.request({ "x-webhook-hmac": t.sign(SECRET, other) }))).status).toBe(
      401,
    );
    t.untouched();
    expect(t.replies).toEqual([]);
  });

  it("links nothing when WAHA_WEBHOOK_SECRET is not set, even with a signature made from an empty key", async () => {
    const t = setup(undefined);
    expect((await t.route(t.request({ "x-webhook-hmac": t.sign("") }))).status).toBe(401);
    t.untouched();
    expect(t.replies).toEqual([]);
  });

  it("links the sender's number with a valid signature", async () => {
    const t = setup();
    expect((await t.route(t.request({ "x-webhook-hmac": t.sign(SECRET) }))).status).toBe(200);
    expect(t.fake.docs.get("memberProfiles/siti")).toMatchObject({
      whatsappNumber: "+6281234567890",
    });
    expect(t.replies).toHaveLength(1);
  });
});

describe("WhatsApp group keywords: only a signed request is answered", () => {
  const group = JSON.stringify({
    event: "message",
    payload: {
      id: "g1",
      from: "120363041@g.us",
      fromMe: false,
      body: "/rekap",
      participant: SENDER,
    },
  });
  const run = async (headers: Record<string, string>) => {
    const heard: unknown[] = [];
    const route = createWahaWebhookRoute({
      secret: SECRET,
      record: () => Promise.resolve(true),
      surveys: { vote: () => Promise.resolve(false) },
      onMessage: (message) => Promise.resolve(void heard.push(message)),
      now: () => now,
    });
    const response = await route(
      new Request("https://admin.example.org/webhooks/waha", {
        method: "POST",
        headers,
        body: group,
      }),
    );
    return { status: response.status, heard };
  };

  it("ignores an unsigned or wrongly signed group message", async () => {
    expect(await run({})).toEqual({ status: 401, heard: [] });
    const wrong = createHmac("sha512", "another-secret-0000").update(group).digest("hex");
    expect(await run({ "x-webhook-hmac": wrong })).toEqual({ status: 401, heard: [] });
  });

  it("hands a signed group message, with its sender, to the keyword handler", async () => {
    const signed = createHmac("sha512", SECRET).update(group).digest("hex");
    expect(await run({ "x-webhook-hmac": signed })).toEqual({
      status: 200,
      heard: [
        { id: "g1", from: "120363041@g.us", fromMe: false, text: "/rekap", participant: SENDER },
      ],
    });
  });
});
