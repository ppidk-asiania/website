import { describe, expect, it } from "vitest";
import {
  applyRateLimit,
  createMemoryRateLimitStore,
  DEFAULT_RATE_LIMIT,
  type RateLimitState,
} from "@website/security";

const at = (iso: string) => new Date(iso);

describe("rate limit policy (100/min, 10k/day, then 50% slower)", () => {
  it("defaults to 100 per minute, 10,000 per day, 50 per minute after the daily quota", () => {
    expect(DEFAULT_RATE_LIMIT).toEqual({ perMinute: 100, perDay: 10_000, throttledPerMinute: 50 });
  });

  it("allows 100 requests in a minute, then denies with Retry-After until the next minute", () => {
    let state: RateLimitState | null = null;
    const now = at("2026-10-07T10:00:20Z");
    for (let i = 0; i < 100; i++) {
      const r = applyRateLimit(state, DEFAULT_RATE_LIMIT, now);
      expect(r.decision.allowed).toBe(true);
      state = r.state;
    }
    const denied = applyRateLimit(state, DEFAULT_RATE_LIMIT, now);
    expect(denied.decision).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 40,
      limit: 100,
    });
    expect(denied.state).toEqual(state); // denied requests are not counted
    expect(
      applyRateLimit(state, DEFAULT_RATE_LIMIT, at("2026-10-07T10:01:00Z")).decision.allowed,
    ).toBe(true);
  });

  it("reports remaining requests", () => {
    const first = applyRateLimit(null, DEFAULT_RATE_LIMIT, at("2026-10-07T10:00:00Z"));
    expect(first.decision).toMatchObject({
      allowed: true,
      limit: 100,
      remaining: 99,
      throttled: false,
    });
  });

  it("after 10,000 requests in a day the per-minute limit drops by 50%", () => {
    const state: RateLimitState = {
      day: "2026-10-07",
      dayCount: 10_000,
      minute: 0,
      minuteCount: 0,
    };
    let s: RateLimitState | null = state;
    const now = at("2026-10-07T18:00:00Z");
    for (let i = 0; i < 50; i++) {
      const r = applyRateLimit(s, DEFAULT_RATE_LIMIT, now);
      expect(r.decision).toMatchObject({ allowed: true, throttled: true, limit: 50 });
      s = r.state;
    }
    expect(applyRateLimit(s, DEFAULT_RATE_LIMIT, now).decision).toMatchObject({
      allowed: false,
      throttled: true,
    });
  });

  it("the daily quota resets at 00:00 UTC", () => {
    const state: RateLimitState = {
      day: "2026-10-07",
      dayCount: 20_000,
      minute: 0,
      minuteCount: 0,
    };
    const r = applyRateLimit(state, DEFAULT_RATE_LIMIT, at("2026-10-08T00:00:01Z"));
    expect(r.decision).toMatchObject({ allowed: true, throttled: false, limit: 100 });
    expect(r.state.dayCount).toBe(1);
  });

  it("memory store: concurrent requests can never exceed the limit (no race)", async () => {
    const store = createMemoryRateLimitStore();
    const now = at("2026-10-07T10:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 150 }, () => store.consume("ip-a", DEFAULT_RATE_LIMIT, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(100);
    expect((await store.consume("ip-b", DEFAULT_RATE_LIMIT, now)).allowed).toBe(true); // keys are independent
  });
});
