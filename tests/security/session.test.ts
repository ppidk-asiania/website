import { describe, expect, it, vi } from "vitest";
import {
  createSessionRoutes,
  SESSION_COOKIE,
  type IdentityProvider,
  type SignIn,
} from "@website/auth";

function provider(over: Partial<IdentityProvider> = {}) {
  const mocks = {
    createSession: vi.fn((uid: string, _provider: string, _maxAgeMs: number) =>
      Promise.resolve(`session-for-${uid}`),
    ),
    verifySessionCookie: vi.fn((cookie: string) =>
      Promise.resolve({
        uid: cookie.replace("session-for-", ""),
        email: null,
        emailVerified: true,
        signInProvider: "google.com",
        authTime: 0,
      }),
    ),
    revokeSessions: vi.fn((_uid: string) => Promise.resolve()),
  };
  const identity: IdentityProvider = { ...mocks, ...over };
  return { identity, mocks };
}

function methods(over: Partial<SignIn> = {}): SignIn {
  return {
    google: vi.fn((credential: string) => Promise.resolve(credential === "good" ? "g1" : null)),
    password: vi.fn((_e: string, password: string) =>
      Promise.resolve(password === "right" ? "p1" : null),
    ),
    signUp: vi.fn((email: string) =>
      Promise.resolve(email === "taken@example.org" ? null : "new1"),
    ),
    requestPasswordReset: vi.fn(() => Promise.resolve()),
    resetPassword: vi.fn((token: string) => Promise.resolve(token === "ok" ? "r1" : null)),
    verifyEmail: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
}

const post = (body: unknown) =>
  new Request("https://web.example.org/api/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("session endpoint (Google, e-mail + password → server session cookie)", () => {
  it("exchanges a Google credential for a hardened session cookie", async () => {
    const { identity, mocks } = provider();
    const res = await createSessionRoutes({ identity, maxAgeHours: 8, signIn: methods() }).POST(
      post({ method: "google", credential: "good" }),
    );
    expect(res.status).toBe(204);
    expect(mocks.createSession).toHaveBeenCalledWith("g1", "google.com", 8 * 3600 * 1000);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=session-for-g1`);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=28800"])
      expect(cookie).toContain(attr);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("uses a __Secure- cookie so one session can be shared by web, admin and shop", () => {
    expect(SESSION_COOKIE).toBe("__Secure-session");
  });

  it("starts sessions for password sign-in, sign-up and password reset", async () => {
    const { identity, mocks } = provider();
    const routes = createSessionRoutes({ identity, maxAgeHours: 8, signIn: methods() });
    const cases: Array<[unknown, string]> = [
      [{ method: "password", email: "A@Example.org", password: "right" }, "p1"],
      [{ method: "signup", email: "new@example.org", password: "long enough" }, "new1"],
      [{ method: "reset", token: "ok", password: "long enough" }, "r1"],
    ];
    for (const [body, uid] of cases) {
      const res = await routes.POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(204);
      expect(mocks.createSession).toHaveBeenLastCalledWith(uid, "password", 8 * 3600 * 1000);
    }
  });

  it("answers a reset request the same way whether or not the address has an account", async () => {
    const requestPasswordReset = vi.fn(() => Promise.resolve());
    const signIn = methods({ requestPasswordReset });
    const routes = createSessionRoutes({ identity: provider().identity, maxAgeHours: 8, signIn });
    const res = await routes.POST(post({ method: "reset-request", email: " Ana@Example.org " }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(requestPasswordReset).toHaveBeenCalledWith("ana@example.org");
  });

  it("sets and clears the shared cookie on the configured parent domain", async () => {
    const { identity } = provider();
    const routes = createSessionRoutes({
      identity,
      maxAgeHours: 8,
      cookieDomain: "ppiasiania.id",
      signIn: methods(),
    });
    const signIn = await routes.POST(post({ method: "google", credential: "good" }));
    expect(signIn.headers.get("set-cookie")).toContain("Domain=ppiasiania.id");
    const signOut = await routes.DELETE(
      new Request("https://admin.ppiasiania.id/api/session", { method: "DELETE" }),
    );
    expect(signOut.headers.get("set-cookie")).toContain("Domain=ppiasiania.id");
    expect(signOut.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects malformed bodies, short passwords and any attempt to choose a uid or role", async () => {
    const routes = createSessionRoutes({
      identity: provider().identity,
      maxAgeHours: 8,
      signIn: methods(),
    });
    for (const body of [
      {},
      { idToken: "t" },
      { method: "google", credential: "" },
      { method: "google", credential: "good", uid: "victim" },
      { method: "google", credential: "good", role: "superadmin" },
      { method: "password", email: "not-an-email", password: "right" },
      { method: "signup", email: "a@example.org", password: "short" },
      { method: "reset", token: "ok", password: "short" },
      { method: "magic" },
      "x",
    ]) {
      expect((await routes.POST(post(body))).status, JSON.stringify(body)).toBe(400);
    }
    const notJson = new Request("https://web.example.org/api/session", {
      method: "POST",
      body: "{",
    });
    expect((await routes.POST(notJson)).status).toBe(400);
  });

  it("refuses every sign-in where no sign-in methods are configured (admin, shop)", async () => {
    const routes = createSessionRoutes({ identity: provider().identity, maxAgeHours: 8 });
    expect((await routes.POST(post({ method: "google", credential: "good" }))).status).toBe(400);
  });

  it("returns a generic 401 for wrong credentials, without leaking the reason", async () => {
    const routes = createSessionRoutes({
      identity: provider().identity,
      maxAgeHours: 8,
      signIn: methods({ google: () => Promise.reject(new Error("Google keys: HTTP 503")) }),
    });
    for (const body of [
      { method: "google", credential: "bad" },
      { method: "password", email: "a@example.org", password: "wrong" },
      { method: "reset", token: "expired", password: "long enough" },
    ]) {
      const res = await routes.POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(401);
      expect(await res.text()).not.toMatch(/503|wrong|expired/);
    }
  });

  it("answers 409 when the address already has an account", async () => {
    const routes = createSessionRoutes({
      identity: provider().identity,
      maxAgeHours: 8,
      signIn: methods(),
    });
    const res = await routes.POST(
      post({ method: "signup", email: "taken@example.org", password: "long enough" }),
    );
    expect(res.status).toBe(409);
  });

  it("records the sign-in for the uid of the VERIFIED session, never for anything in the body", async () => {
    const { identity, mocks } = provider();
    const onSignIn = vi.fn(() => Promise.resolve());
    const routes = createSessionRoutes({ identity, maxAgeHours: 8, onSignIn, signIn: methods() });
    expect((await routes.POST(post({ method: "google", credential: "good" }))).status).toBe(204);
    expect(mocks.verifySessionCookie).toHaveBeenCalledWith("session-for-g1");
    expect(onSignIn).toHaveBeenCalledWith(expect.objectContaining({ uid: "g1" }));
    expect((await routes.start("pk1", "passkey")).status).toBe(204);
    expect(mocks.createSession).toHaveBeenLastCalledWith("pk1", "passkey", 8 * 3600 * 1000);
  });

  it("records nothing and sets no cookie when the new session does not verify", async () => {
    const onSignIn = vi.fn(() => Promise.resolve());
    const unverified = provider({ verifySessionCookie: () => Promise.resolve(null) });
    const res = await createSessionRoutes({
      identity: unverified.identity,
      maxAgeHours: 8,
      onSignIn,
      signIn: methods(),
    }).POST(post({ method: "google", credential: "good" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("sign-out revokes the user's sessions and clears the cookie", async () => {
    const { identity, mocks } = provider();
    const signOut = new Request("https://web.example.org/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=session-for-u1` },
    });
    const res = await createSessionRoutes({ identity, maxAgeHours: 8 }).DELETE(signOut);
    expect(res.status).toBe(204);
    expect(mocks.revokeSessions).toHaveBeenCalledWith("u1");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("sign-out without (or with an invalid) session still clears the cookie", async () => {
    const { identity, mocks } = provider({ verifySessionCookie: () => Promise.resolve(null) });
    const routes = createSessionRoutes({ identity, maxAgeHours: 8 });
    const bare = await routes.DELETE(
      new Request("https://web.example.org/api/session", { method: "DELETE" }),
    );
    expect(bare.status).toBe(204);
    const invalid = await routes.DELETE(
      new Request("https://web.example.org/api/session", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE}=bad` },
      }),
    );
    expect(invalid.status).toBe(204);
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });
});
