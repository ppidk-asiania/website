import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlMemberProfileStore,
  createSqlUniversityStore,
  createSqlWebhookEventStore,
  deleteExpired,
} from "@website/db/sql";
import {
  newLinkCode,
  numberFromChatId,
  parseLinkMessage,
  PRIVACY_POLICY_VERSION,
  WHATSAPP_LINK_PURPOSE,
  WHATSAPP_LINK_TTL_MS,
  whatsappLinkText,
} from "@website/domain/members";
import { keyedHash } from "@website/security";
import { createWahaWebhookRoute } from "../../apps/admin/src/server/polls";
import { wahaResolveLid } from "../../apps/admin/src/server/whatsapp";
import { createWhatsappLinking } from "../../apps/admin/src/server/whatsapp-link";
import { createOwnProfile } from "../../apps/web/src/server/profile";
import { createWhatsappLink } from "../../apps/web/src/server/whatsapp-link";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMemberProfileStore>[0];
const now = new Date("2026-11-16T05:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const HASH_SECRET = "h".repeat(32);
const hash = (code: string) => keyedHash(WHATSAPP_LINK_PURPOSE, code, HASH_SECRET);
const input = {
  fullName: "Siti Rahma",
  gender: "female",
  dateOfBirth: "2001-05-20",
  ppiCountry: "JP",
  university: "Kyoto University",
  educationLevel: "master",
  majors: ["Civil Engineering"],
  yearOfEntry: 2025,
  estimatedGraduationYear: 2027,
  addressAbroad: { line1: "1-2-3 Sakyo-ku", city: "Kyoto", countryCode: "JP" },
  addressIndonesia: { line1: "Jl. Merdeka No. 10", city: "Kota Bandung", province: "Jawa Barat" },
  whatsappNumber: "+6281111111111",
  emergencyContact: { phone: "+6281222222222" },
  timezone: "Asia/Tokyo",
  consent: { privacyPolicyVersion: PRIVACY_POLICY_VERSION, accepted: true },
};
const siti = { uid: "siti", email: "siti@example.org", emailVerified: true };
const budi = { uid: "budi", email: "budi@example.org", emailVerified: true };
const NUMBER = "+6289999999999";

let fake: ReturnType<typeof fakeDb>;
let store: ReturnType<typeof createSqlMemberProfileStore>;
const own = () =>
  createOwnProfile({
    profiles: store,
    universities: createSqlUniversityStore(fake.db as unknown as Db),
    now: () => now,
  });
const profileOf = (uid: string) =>
  fake.docs.get(`memberProfiles/${uid}`) as Record<string, unknown>;
const codeDocs = () => [...fake.docs.keys()].filter((k) => k.startsWith("whatsappLinkCodes/"));

beforeEach(async () => {
  fake = fakeDb();
  store = createSqlMemberProfileStore(fake.db as unknown as Db);
  for (const uid of ["siti", "budi"]) fake.docs.set(`users/${uid}`, { uid, status: "active" });
  fake.docs.set("chapters/ch-jp", { countryCode: "JP", active: true, name: "PPI Jepang" });
  await own().save(siti, { version: null, profile: input });
  await own().save(budi, {
    version: null,
    profile: { ...input, fullName: "Budi", whatsappNumber: "+6281333333333" },
  });
});

describe("link code rules", () => {
  it("is 8 characters from an alphabet without look-alikes", () => {
    let n = 0;
    const code = newLinkCode((max) => n++ % max);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(newLinkCode(() => 30)).toBe("99999999");
  });

  it("reads '/asiania CODE' only", () => {
    expect(whatsappLinkText("ABCD2345")).toBe("/asiania ABCD2345");
    expect(parseLinkMessage("/asiania ABCD2345")).toEqual({ code: "ABCD2345" });
    expect(parseLinkMessage("  /Asiania   abcd2345 \n")).toEqual({ code: "ABCD2345" });
    expect(parseLinkMessage("/asiania abc")).toEqual({ code: null });
    expect(parseLinkMessage("/asiania ABCD0O1I")).toEqual({ code: null });
    expect(parseLinkMessage("/asiania")).toBeNull();
    expect(parseLinkMessage("hello /asiania ABCD2345")).toBeNull();
  });

  it("takes a number from a private chat id only", () => {
    expect(numberFromChatId("6281234567890@c.us")).toBe("+6281234567890");
    expect(numberFromChatId("1203630@g.us")).toBeNull();
    expect(numberFromChatId("98765@lid")).toBeNull();
    expect(numberFromChatId("12@c.us")).toBeNull();
  });
});

describe("web: Link my WhatsApp", () => {
  const link = (botNumber: string | null = "+6281000000001", seed = 0) => {
    let n = seed;
    return createWhatsappLink({
      profiles: store,
      hash,
      randomInt: (max) => n++ % max,
      botNumber,
      now: () => now,
    });
  };

  it("makes a code, stored hashed, with a wa.me link; a new code cancels the old one", async () => {
    const first = await link().issue(siti);
    if (!first.ok) throw new Error("expected a code");
    expect(first.text).toMatch(/^\/asiania [A-Z2-9]{8}$/);
    expect(first.url).toBe(`https://wa.me/6281000000001?text=${encodeURIComponent(first.text)}`);
    expect(first.expiresAt).toBe(later(WHATSAPP_LINK_TTL_MS).toISOString());
    expect(codeDocs()).toEqual([`whatsappLinkCodes/${hash(first.code)}`]);
    expect(JSON.stringify([...fake.docs.entries()])).not.toContain(first.code);

    const second = await link(undefined, 5).issue(siti);
    if (!second.ok) throw new Error("expected a code");
    expect(second.code).not.toBe(first.code);
    expect(codeDocs()).toEqual([`whatsappLinkCodes/${hash(second.code)}`]);
    expect(await store.linkWhatsapp(hash(first.code), NUMBER, now)).toEqual({
      ok: false,
      reason: "invalid",
    });
    await link(undefined, 9).issue(budi);
    expect(codeDocs()).toHaveLength(2);
  });

  it("needs a signed-in member with a profile and a configured bot number", async () => {
    expect(await link().issue(null)).toEqual({ ok: false, error: "signin" });
    expect(await link(null).issue(siti)).toEqual({ ok: false, error: "not_configured" });
    expect(await link().issue({ ...siti, uid: "nobody" })).toEqual({
      ok: false,
      error: "profile",
    });
  });
});

describe("linking by message", () => {
  const issue = async (uid: string, seed: number, at = now) => {
    const result = await createWhatsappLink({
      profiles: store,
      hash,
      randomInt: (max) => seed++ % max,
      botNumber: "+6281000000001",
      now: () => at,
    }).issue({ uid, email: `${uid}@example.org`, emailVerified: true });
    if (!result.ok) throw new Error("expected a code");
    return result.code;
  };

  it("saves the number as verified, audits without the number, and uses the code once", async () => {
    const code = await issue("siti", 0);
    const before = profileOf("siti");
    expect(await store.linkWhatsapp(hash(code), NUMBER, later(60_000))).toEqual({
      ok: true,
      uid: "siti",
    });
    expect(profileOf("siti")).toMatchObject({
      whatsappNumber: NUMBER,
      version: (before["version"] as number) + 1,
    });
    expect(profileOf("siti")["whatsappVerifiedAt"]).toBeDefined();
    expect((await store.findByUserId("siti"))?.whatsappVerifiedAt).toEqual(later(60_000));
    const audit = [...fake.docs.entries()].filter(([k]) => k.startsWith("auditLogs/"));
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(NUMBER.slice(1));
    expect(codeDocs()).toEqual([]);
    expect(await store.linkWhatsapp(hash(code), "+6281777777777", later(61_000))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(profileOf("siti")["whatsappNumber"]).toBe(NUMBER);
  });

  it("refuses an expired code (and removes it) and an unknown one", async () => {
    const code = await issue("siti", 0);
    expect(await store.linkWhatsapp(hash(code), NUMBER, later(WHATSAPP_LINK_TTL_MS + 1))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(codeDocs()).toEqual([]);
    expect(profileOf("siti")["whatsappNumber"]).toBe("+6281111111111");
    expect(await store.linkWhatsapp(hash("ZZZZ2222"), NUMBER, now)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("the cron job `expire` deletes old codes", async () => {
    await issue("siti", 0);
    expect((await deleteExpired(fake.db as unknown as Db, now)).whatsappLinkCodes).toBe(0);
    expect(
      (await deleteExpired(fake.db as unknown as Db, later(WHATSAPP_LINK_TTL_MS)))
        .whatsappLinkCodes,
    ).toBe(1);
  });

  it("refuses a number already verified on another account, but not one only typed there", async () => {
    await store.linkWhatsapp(hash(await issue("budi", 3)), NUMBER, now);
    const code = await issue("siti", 0);
    expect(await store.linkWhatsapp(hash(code), NUMBER, now)).toEqual({
      ok: false,
      reason: "taken",
    });
    expect(profileOf("siti")["whatsappNumber"]).toBe("+6281111111111");
    expect(codeDocs()).toEqual([]);
    // Siti's typed number is not verified, so Budi can verify it.
    expect(
      await store.linkWhatsapp(hash(await issue("budi", 7)), "+6281111111111", now),
    ).toMatchObject({ ok: true });
  });

  it("re-linking the same account to its own number is allowed", async () => {
    await store.linkWhatsapp(hash(await issue("siti", 0)), NUMBER, now);
    expect(await store.linkWhatsapp(hash(await issue("siti", 4)), NUMBER, later(1000))).toEqual({
      ok: true,
      uid: "siti",
    });
  });

  it("typing a number by hand clears the verification; saving the same number keeps it", async () => {
    await store.linkWhatsapp(hash(await issue("siti", 0)), NUMBER, now);
    const verified = (await store.findByUserId("siti"))!;
    await own().save(siti, {
      version: verified.version,
      profile: { ...input, whatsappNumber: NUMBER, timezone: "Asia/Seoul" },
    });
    expect((await store.findByUserId("siti"))?.whatsappVerifiedAt).toEqual(now);
    const kept = (await store.findByUserId("siti"))!;
    await own().save(siti, {
      version: kept.version,
      profile: { ...input, whatsappNumber: "+6281555555555" },
    });
    expect((await store.findByUserId("siti"))?.whatsappVerifiedAt).toBeNull();
  });
});

describe("POST /webhooks/waha message event", () => {
  const SECRET = "waha-webhook-secret-123";
  const replies: Array<{ to: string; text: string; key: string }> = [];
  const lids = new Map([["555@lid", "+6285551234567"]]);
  const errors: string[] = [];
  const route = () =>
    createWahaWebhookRoute({
      secret: SECRET,
      record: (provider, id, at) =>
        createSqlWebhookEventStore(fake.db as unknown as Db).record(provider, id, at),
      surveys: { vote: () => Promise.resolve(false) },
      onMessage: createWhatsappLinking({
        record: (provider, id, at) =>
          createSqlWebhookEventStore(fake.db as unknown as Db).record(provider, id, at),
        profiles: store,
        hash,
        resolveLid: (lid) => Promise.resolve(lids.get(lid) ?? null),
        reply: (to, text, key) => Promise.resolve(replies.push({ to, text, key })),
        logError: (message) => errors.push(message),
        now: () => now,
      }),
      now: () => now,
    });
  const send = (message: Record<string, unknown>) => {
    const text = JSON.stringify({ event: "message", payload: { fromMe: false, ...message } });
    return route()(
      new Request("https://admin.example.org/webhooks/waha", {
        method: "POST",
        headers: { "x-webhook-hmac": createHmac("sha512", SECRET).update(text).digest("hex") },
        body: text,
      }),
    );
  };
  const issue = async (uid: string, seed: number) => {
    const result = await createWhatsappLink({
      profiles: store,
      hash,
      randomInt: (max) => seed++ % max,
      botNumber: "+6281000000001",
      now: () => now,
    }).issue({ uid, email: `${uid}@example.org`, emailVerified: true });
    if (!result.ok) throw new Error("expected a code");
    return result.code;
  };
  beforeEach(() => {
    replies.length = 0;
    errors.length = 0;
  });

  it("links the sender's number from a private chat and replies without the code", async () => {
    const code = await issue("siti", 0);
    expect(
      (await send({ id: "m1", from: "6285550001111@c.us", body: `/asiania ${code}` })).status,
    ).toBe(200);
    expect(profileOf("siti")["whatsappNumber"]).toBe("+6285550001111");
    expect(replies).toHaveLength(1);
    expect(replies[0]?.to).toBe("+6285550001111");
    expect(replies[0]?.text).not.toContain(code);
    expect(replies[0]?.key).toMatch(/^whatsapp-link:[0-9a-f]{64}$/);
  });

  it("resolves a LID sender to a number through WAHA", async () => {
    const code = await issue("siti", 0);
    await send({ id: "m2", from: "555@lid", body: `/asiania ${code}` });
    expect(profileOf("siti")["whatsappNumber"]).toBe("+6285551234567");
    expect(replies[0]?.to).toBe("+6285551234567");
  });

  it("does nothing for an unknown LID, a group, our own message or a normal text", async () => {
    const code = await issue("siti", 0);
    await send({ id: "m3", from: "999@lid", body: `/asiania ${code}` });
    await send({
      id: "m4",
      from: "123@g.us",
      participant: "6285550001111@c.us",
      body: `/asiania ${code}`,
    });
    await send({ id: "m5", from: "6285550001111@c.us", fromMe: true, body: `/asiania ${code}` });
    await send({ id: "m6", from: "6285550001111@c.us", body: "hello" });
    await send({ from: "6285550001111@c.us", body: `/asiania ${code}` });
    expect(profileOf("siti")["whatsappNumber"]).toBe("+6281111111111");
    expect(replies).toEqual([]);
    expect(errors).toEqual(["whatsapp link: sender not resolved"]);
  });

  it("answers an invalid, expired or reused code, a taken number, and handles a replayed event once", async () => {
    await send({ id: "a1", from: "6285550001111@c.us", body: "/asiania nonsense" });
    await send({ id: "a2", from: "6285550001111@c.us", body: "/asiania ZZZZ2222" });
    expect(replies.map((r) => r.text)).toEqual([
      expect.stringContaining("tidak valid"),
      expect.stringContaining("tidak valid"),
    ]);
    replies.length = 0;

    const code = await issue("siti", 0);
    await send({ id: "a3", from: "6285550001111@c.us", body: `/asiania ${code}` });
    await send({ id: "a3", from: "6285550001111@c.us", body: `/asiania ${code}` });
    expect(replies).toHaveLength(1);
    await send({ id: "a4", from: "6285550001111@c.us", body: `/asiania ${code}` });
    expect(replies[1]?.text).toContain("tidak valid");

    const other = await issue("budi", 9);
    await send({ id: "a5", from: "6285550001111@c.us", body: `/asiania ${other}` });
    expect(replies[2]?.text).toContain("akun lain");
    expect(profileOf("budi")["whatsappNumber"]).toBe("+6281333333333");
    for (const reply of replies) expect(reply.text).not.toMatch(/[A-Z2-9]{8}/);
  });
});

describe("WAHA: resolve a LID", () => {
  const config = { baseUrl: "https://waha.example.org/", apiKey: "k", session: "default" };
  it("asks GET /api/{session}/lids/{lid} and reads the phone number", async () => {
    const calls: string[] = [];
    const fetchOk = ((url: string) => {
      calls.push(url);
      return Promise.resolve(Response.json({ lid: "555@lid", pn: "6285551234567@c.us" }));
    }) as unknown as typeof fetch;
    expect(await wahaResolveLid(config, fetchOk)("555@lid")).toBe("+6285551234567");
    expect(calls).toEqual(["https://waha.example.org/api/default/lids/555%40lid"]);
  });

  it("returns null when unknown, failing or not configured", async () => {
    const answer = (response: Response | Error) =>
      wahaResolveLid(config, () =>
        response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      )("555@lid");
    expect(await answer(Response.json({ lid: "555@lid", pn: null }))).toBeNull();
    expect(await answer(Response.json({ pn: "group@g.us" }))).toBeNull();
    expect(await answer(new Response("", { status: 404 }))).toBeNull();
    expect(await answer(new Error("offline"))).toBeNull();
    expect(await wahaResolveLid(null)("555@lid")).toBeNull();
  });
});
