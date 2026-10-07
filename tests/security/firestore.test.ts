import { describe, expect, it, vi } from "vitest";
import {
  createFirestoreRateLimitStore,
  getDocumentsByIds,
  getFirestoreForRole,
} from "@website/db/firestore";
import { DEFAULT_RATE_LIMIT } from "@website/security";

type Firestore = Parameters<typeof createFirestoreRateLimitStore>[0];

/** Minimal in-memory stand-in for the parts of Firestore we use. Transactions run one at a time. */
function fakeFirestore(options: { failWith?: Error } = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const getAll = vi.fn((...refs: Array<{ path: string; id: string }>) =>
    Promise.resolve(
      refs.map((ref) => ({
        id: ref.id,
        exists: docs.has(ref.path),
        data: () => docs.get(ref.path),
      })),
    ),
  );
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ id, path: `${name}/${id}` }) }),
    getAll,
    runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      if (options.failWith) return Promise.reject(options.failWith);
      const run = queue.then(() =>
        fn({
          get: (ref: { path: string }) =>
            Promise.resolve({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
          set: (ref: { path: string }, data: Record<string, unknown>) => {
            docs.set(ref.path, data);
            writes.push({ path: ref.path, data });
          },
        }),
      );
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  return { db: db as unknown as Firestore, docs, writes, getAll };
}

describe("Firestore rate-limit store (shared across server instances)", () => {
  const now = new Date("2026-10-07T10:00:00Z");

  it("enforces the limit atomically under concurrency", async () => {
    const { db } = fakeFirestore();
    const store = createFirestoreRateLimitStore(db);
    const results = await Promise.all(
      Array.from({ length: 120 }, () => store.consume("ip_abc", DEFAULT_RATE_LIMIT, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(100);
  });

  it("writes only allowed requests, with a TTL field for automatic cleanup", async () => {
    const { db, writes } = fakeFirestore();
    const store = createFirestoreRateLimitStore(db);
    await store.consume("ip_abc", { ...DEFAULT_RATE_LIMIT, perMinute: 1 }, now);
    await store.consume("ip_abc", { ...DEFAULT_RATE_LIMIT, perMinute: 1 }, now);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("rateLimits/ip_abc");
    expect(writes[0]?.data["expiresAt"]).toEqual(new Date("2026-10-09T00:00:00Z"));
  });

  it("treats transaction contention as 'limited' (abusive bursts), and rethrows other errors", async () => {
    const contended = createFirestoreRateLimitStore(
      fakeFirestore({ failWith: Object.assign(new Error("ABORTED"), { code: 10 }) }).db,
    );
    expect(await contended.consume("ip_abc", DEFAULT_RATE_LIMIT, now)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    const down = createFirestoreRateLimitStore(
      fakeFirestore({ failWith: Object.assign(new Error("UNAVAILABLE"), { code: 14 }) }).db,
    );
    await expect(down.consume("ip_abc", DEFAULT_RATE_LIMIT, now)).rejects.toThrow("UNAVAILABLE");
  });

  it("rejects unsafe document keys", async () => {
    const store = createFirestoreRateLimitStore(fakeFirestore().db);
    await expect(store.consume("../users/x", DEFAULT_RATE_LIMIT, now)).rejects.toThrow();
  });
});

describe("N+1 prevention: batched reads", () => {
  it("loads many documents in one round trip, de-duplicated, in input order", async () => {
    const { db, docs, getAll } = fakeFirestore();
    docs.set("memberProfiles/u1", { fullName: "A" });
    docs.set("memberProfiles/u3", { fullName: "C" });
    const result = await getDocumentsByIds<{ fullName: string }>(db, "memberProfiles", [
      "u1",
      "u2",
      "u1",
      "u3",
    ]);
    expect(getAll).toHaveBeenCalledOnce();
    expect([...result.entries()]).toEqual([
      ["u1", { fullName: "A" }],
      ["u2", null],
      ["u3", { fullName: "C" }],
    ]);
  });

  it("chunks very large batches and skips the call for an empty list", async () => {
    const { db, getAll } = fakeFirestore();
    await getDocumentsByIds(db, "users", []);
    expect(getAll).not.toHaveBeenCalled();
    await getDocumentsByIds(
      db,
      "users",
      Array.from({ length: 250 }, (_, i) => `u${i}`),
    );
    expect(getAll).toHaveBeenCalledTimes(3);
  });

  it("rejects ids that could address other documents (path injection)", async () => {
    await expect(
      getDocumentsByIds(fakeFirestore().db, "users", ["ok", "x/../../admin"]),
    ).rejects.toThrow();
  });
});

describe("connection pooling: one Firestore client per role, reused", () => {
  it("returns the same pooled client on every call and separate clients per role", () => {
    const config = {
      appEnv: "test" as const,
      projectId: "demo-ppidk-website",
      emulatorHost: "127.0.0.1:8080",
    };
    const a = getFirestoreForRole({ ...config, role: "web_ro" });
    const b = getFirestoreForRole({ ...config, role: "web_ro" });
    const c = getFirestoreForRole({ ...config, role: "admin_rw" });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
