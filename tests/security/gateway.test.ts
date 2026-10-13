import { describe, expect, it } from "vitest";
import { generateApiKey } from "@website/apikeys";
import { createMemoryGatewayRepositories } from "@website/db/memory";
import { createLogger } from "@website/observability";
import { createMemoryRateLimitStore } from "@website/security";
import { createGatewayApp } from "../../apps/gateway/src/app";

const pepper = "security-test-pepper-0123456789abcdef0123";
const key = generateApiKey("test", pepper);
const repos = createMemoryGatewayRepositories({
  apiKeys: [
    {
      keyId: key.keyId,
      clientId: "c",
      environment: "test",
      secretHash: key.secretHash,
      scopes: ["events.read"],
      expiresAt: null,
      revokedAt: null,
      rateLimitPerMinute: null,
    },
  ],
});
function app() {
  return createGatewayApp({
    logger: createLogger({ service: "t", level: "error", write: () => undefined }),
    apiKeys: repos.apiKeys,
    events: repos.events,
    rateLimitStore: createMemoryRateLimitStore(),
    rateLimitSecret: "gateway-rate-limit-secret-0123456789abcd",
    apiKeyPepper: pepper,
    keyEnvironment: "test",
    defaultRateLimitPerMinute: 1000,
    now: () => new Date("2026-10-07T10:00:00Z"),
  });
}

describe("gateway security", () => {
  it("rate-limits per client IP at 100 requests/minute (429 + Retry-After)", async () => {
    const a = app();
    const fromIp = { headers: { "x-real-ip": "203.0.113.5" } };
    for (let i = 0; i < 100; i++) expect((await a.request("/health", fromIp)).status).toBe(200);
    const limited = await a.request("/health", fromIp);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await a.request("/health", { headers: { "x-real-ip": "203.0.113.6" } })).status).toBe(
      200,
    );
  });

  it("refuses browser calls from other websites (CORS/CSRF)", async () => {
    const res = await app().request("/v1/events", {
      headers: { origin: "https://evil.example", authorization: `Bearer ${key.plaintext}` },
    });
    expect(res.status).toBe(403);
  });

  it("sends HSTS and never lets shared caches store API responses", async () => {
    const res = await app().request("/v1/events", {
      headers: { authorization: `Bearer ${key.plaintext}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("ratelimit-limit")).toBe("100");
  });

  it("rejects injection attempts in query parameters", async () => {
    const res = await app().request("/v1/events?chapterId=../users", {
      headers: { authorization: `Bearer ${key.plaintext}` },
    });
    expect(res.status).toBe(400);
  });

  it("errors never expose internal details", async () => {
    const broken = createGatewayApp({
      ...{
        logger: createLogger({ service: "t", level: "error", write: () => undefined }),
        apiKeys: repos.apiKeys,
        rateLimitStore: createMemoryRateLimitStore(),
        rateLimitSecret: "gateway-rate-limit-secret-0123456789abcd",
        apiKeyPepper: pepper,
        keyEnvironment: "test" as const,
        defaultRateLimitPerMinute: 1000,
        now: () => new Date("2026-10-07T10:00:00Z"),
      },
      events: {
        listPublished: () => Promise.reject(new Error("firestore password=hunter2 at /srv")),
        findById: () => Promise.resolve(null),
      },
    });
    const res = await broken.request("/v1/events", {
      headers: { authorization: `Bearer ${key.plaintext}` },
    });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toMatch(/hunter2|\/srv|stack/);
  });
});

describe("gateway rate-limit store outage", () => {
  it("fails open and logs, so an outage does not take the API down", async () => {
    const lines: string[] = [];
    const a = createGatewayApp({
      logger: createLogger({ service: "t", level: "error", write: (line) => lines.push(line) }),
      apiKeys: repos.apiKeys,
      events: repos.events,
      rateLimitStore: { consume: () => Promise.reject(new Error("store down")) },
      rateLimitSecret: "gateway-rate-limit-secret-0123456789abcd",
      apiKeyPepper: pepper,
      keyEnvironment: "test",
      defaultRateLimitPerMinute: 1000,
      now: () => new Date("2026-10-07T10:00:00Z"),
    });
    expect((await a.request("/health")).status).toBe(200);
    expect(lines.join()).toContain("rate_limit_store_error");
  });
});
