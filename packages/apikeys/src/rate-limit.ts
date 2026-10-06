/** Rate limiter port. Production: a managed store (e.g. Upstash) — in-memory is per-instance only. */
export interface RateLimiter {
  consume(
    key: string,
    limitPerMinute: number,
    now: Date,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

/** Fixed-window limiter for local development and tests. NOT for production. */
export function createInMemoryRateLimiter(): RateLimiter {
  const windows = new Map<string, { windowStart: number; count: number }>();
  return {
    consume(key, limitPerMinute, now) {
      const minute = Math.floor(now.getTime() / 60_000) * 60_000;
      const current = windows.get(key);
      const window =
        current && current.windowStart === minute ? current : { windowStart: minute, count: 0 };
      window.count += 1;
      windows.set(key, window);
      const allowed = window.count <= limitPerMinute;
      const retryAfterSeconds = allowed ? 0 : Math.ceil((minute + 60_000 - now.getTime()) / 1000);
      return Promise.resolve({ allowed, retryAfterSeconds });
    },
  };
}
