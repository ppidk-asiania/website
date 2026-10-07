import { describe, expect, it } from "vitest";
import { generateApiKey, parseApiKey, verifyApiKey, type ApiKeyRecord } from "@website/apikeys";

const pepper = "unit-test-pepper-0123456789abcdef0123456789";
const now = new Date("2026-10-07T00:00:00Z");

function store(record: ApiKeyRecord) {
  return { findByKeyId: (id: string) => Promise.resolve(id === record.keyId ? record : null) };
}

describe("api keys", () => {
  const generated = generateApiKey("test", pepper);
  const record: ApiKeyRecord = {
    keyId: generated.keyId,
    clientId: "partner-1",
    environment: "test",
    secretHash: generated.secretHash,
    scopes: ["events.read"],
    expiresAt: null,
    revokedAt: null,
    rateLimitPerMinute: null,
  };

  it("generates parseable keys and stores only a hash", () => {
    const parsed = parseApiKey(generated.plaintext);
    expect(parsed).not.toBeNull();
    expect(generated.secretHash).not.toBe(parsed?.secret);
    expect(generated.plaintext).not.toContain(generated.secretHash);
  });

  it("verifies valid keys and rejects tampered, revoked, expired and wrong-environment keys", async () => {
    const ok = await verifyApiKey({
      raw: generated.plaintext,
      store: store(record),
      pepper,
      expectedEnvironment: "test",
      now,
    });
    expect(ok.ok).toBe(true);
    const tampered = `${generated.plaintext.slice(0, -1)}${generated.plaintext.endsWith("A") ? "B" : "A"}`;
    expect(
      await verifyApiKey({
        raw: tampered,
        store: store(record),
        pepper,
        expectedEnvironment: "test",
        now,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await verifyApiKey({
        raw: generated.plaintext,
        store: store({ ...record, revokedAt: now }),
        pepper,
        expectedEnvironment: "test",
        now,
      }),
    ).toMatchObject({ reason: "revoked" });
    expect(
      await verifyApiKey({
        raw: generated.plaintext,
        store: store({ ...record, expiresAt: now }),
        pepper,
        expectedEnvironment: "test",
        now,
      }),
    ).toMatchObject({ reason: "expired" });
    expect(
      await verifyApiKey({
        raw: generated.plaintext,
        store: store(record),
        pepper,
        expectedEnvironment: "live",
        now,
      }),
    ).toMatchObject({
      reason: "wrong_environment",
    });
  });
});
