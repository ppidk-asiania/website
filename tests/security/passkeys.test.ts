import { describe, expect, it, vi } from "vitest";
import {
  createPasskeyRoutes,
  deviceLabel,
  PASSKEY_CHALLENGE_COOKIE,
  SESSION_COOKIE,
  type IdentityProvider,
  type PasskeyStore,
} from "@website/auth";
import { createMemoryPasskeyStore } from "@website/db/memory";
import { createSoftwareAuthenticator } from "../support/software-authenticator";

const ORIGIN = "https://web.example.org";
const NOW = new Date("2026-10-07T10:00:00Z");
const nowSeconds = NOW.getTime() / 1000;

function setup(
  options: {
    authTime?: number;
    store?: PasskeyStore;
    realClock?: boolean;
    providers?: number;
  } = {},
) {
  const store = options.store ?? createMemoryPasskeyStore();
  const startSession = vi.fn(
    (uid: string) =>
      new Response(null, {
        status: 204,
        headers: { "Set-Cookie": `${SESSION_COOKIE}=for-${uid}` },
      }),
  );
  const identity: IdentityProvider = {
    createSession: () => Promise.resolve("unused"),
    verifySessionCookie: (cookie) =>
      Promise.resolve(
        cookie === "bob-session"
          ? {
              uid: "bob",
              email: null,
              emailVerified: false,
              signInProvider: "passkey",
              authTime: nowSeconds - 60,
            }
          : cookie === "alice-session"
            ? {
                uid: "alice",
                email: "alice@example.org",
                emailVerified: true,
                signInProvider: "password",
                authTime: options.authTime ?? nowSeconds - 60,
              }
            : null,
      ),
    revokeSessions: () => Promise.resolve(),
  };
  let clock = NOW;
  const routes = createPasskeyRoutes({
    store,
    identity,
    rpName: "PPIDK Asia-Oseania",
    origin: ORIGIN,
    providerCount: () => Promise.resolve(options.providers ?? 1),
    startSession: (uid) => Promise.resolve(startSession(uid)),
    ...(options.realClock ? {} : { now: () => clock }),
  });
  return {
    routes,
    store,
    startSession,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const post = (body: unknown, cookies: Record<string, string> = {}, userAgent?: string) =>
  new Request(`${ORIGIN}/api/passkeys/x`, {
    method: "POST",
    body: body === undefined ? null : JSON.stringify(body),
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
  });

function challengeCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${PASSKEY_CHALLENGE_COOKIE}=([^;]*)`).exec(header);
  return match?.[1] ?? "";
}

async function registerPasskey(ctx: ReturnType<typeof setup>, name?: string) {
  const authenticator = createSoftwareAuthenticator(ORIGIN, "alice");
  const optionsRes = await ctx.routes.registerOptions(
    post(undefined, { [SESSION_COOKIE]: "alice-session" }),
  );
  const options = (await optionsRes.json()) as { challenge: string };
  const res = await ctx.routes.registerVerify(
    post(
      { ...authenticator.register(options.challenge), ...(name === undefined ? {} : { name }) },
      {
        [SESSION_COOKIE]: "alice-session",
        [PASSKEY_CHALLENGE_COOKIE]: challengeCookie(optionsRes),
      },
      CHROME_MAC,
    ),
  );
  return { authenticator, res };
}

async function startLogin(ctx: ReturnType<typeof setup>) {
  const res = await ctx.routes.loginOptions(post(undefined));
  const options = (await res.json()) as {
    challenge: string;
    rpId: string;
    userVerification: string;
  };
  return { options, cookie: challengeCookie(res) };
}

describe("passkey registration", () => {
  it("requires a signed-in user", async () => {
    const { routes } = setup();
    expect((await routes.registerOptions(post(undefined))).status).toBe(401);
    expect(
      (await routes.registerOptions(post(undefined, { [SESSION_COOKIE]: "forged" }))).status,
    ).toBe(401);
  });

  it("requires a recent sign-in (adding a credential is sensitive)", async () => {
    const { routes } = setup({ authTime: nowSeconds - 60 * 60 });
    expect(
      (await routes.registerOptions(post(undefined, { [SESSION_COOKIE]: "alice-session" }))).status,
    ).toBe(401);
  });

  it("issues options for this site with user verification and a short-lived, HttpOnly challenge cookie", async () => {
    const { routes } = setup();
    const res = await routes.registerOptions(
      post(undefined, { [SESSION_COOKIE]: "alice-session" }),
    );
    expect(res.status).toBe(200);
    const options = (await res.json()) as {
      rp: { id: string };
      authenticatorSelection: Record<string, string>;
    };
    expect(options.rp.id).toBe("web.example.org");
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Max-Age=300", "Path=/"])
      expect(cookie).toContain(attr);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("verifies and stores a real credential", async () => {
    const ctx = setup();
    const { authenticator, res } = await registerPasskey(ctx);
    expect(res.status).toBe(204);
    const stored = await ctx.store.findById(authenticator.id);
    expect(stored).toMatchObject({
      id: authenticator.id,
      userId: "alice",
      counter: 0,
      transports: ["internal"],
      name: "",
      device: "Chrome · macOS",
    });
  });

  it("excludes credentials the user already has", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const res = await ctx.routes.registerOptions(
      post(undefined, { [SESSION_COOKIE]: "alice-session" }),
    );
    const options = (await res.json()) as { excludeCredentials: Array<{ id: string }> };
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([authenticator.id]);
  });

  it("rejects a response for another website (phishing) and malformed bodies", async () => {
    const ctx = setup();
    const authenticator = createSoftwareAuthenticator(ORIGIN, "alice");
    for (const make of [
      (challenge: string) => authenticator.register(challenge, { origin: "https://evil.example" }),
      () => ({ id: "x" }),
      () => "not-an-object",
    ]) {
      const optionsRes = await ctx.routes.registerOptions(
        post(undefined, { [SESSION_COOKIE]: "alice-session" }),
      );
      const { challenge } = (await optionsRes.json()) as { challenge: string };
      const res = await ctx.routes.registerVerify(
        post(make(challenge), {
          [SESSION_COOKIE]: "alice-session",
          [PASSKEY_CHALLENGE_COOKIE]: challengeCookie(optionsRes),
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(await ctx.store.listByUser("alice")).toEqual([]);
  });

  it("rejects verification without a session or without a valid challenge", async () => {
    const ctx = setup();
    const authenticator = createSoftwareAuthenticator(ORIGIN, "alice");
    expect((await ctx.routes.registerVerify(post(authenticator.register("x")))).status).toBe(401);
    const res = await ctx.routes.registerVerify(
      post(authenticator.register("x"), {
        [SESSION_COOKIE]: "alice-session",
        [PASSKEY_CHALLENGE_COOKIE]: "unknown",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("passkey sign-in", () => {
  it("signs the user in: a verified assertion starts a session for that user", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    expect(options).toMatchObject({ rpId: "web.example.org", userVerification: "required" });
    const res = await ctx.routes.loginVerify(
      post(authenticator.authenticate(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
    );
    expect(res.status).toBe(204);
    expect(ctx.startSession).toHaveBeenCalledWith("alice");
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=for-alice`);
    expect((await ctx.store.findById(authenticator.id))?.counter).toBe(1);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("a challenge can be used only once, even by concurrent requests (no replay, no race)", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    const assertion = authenticator.authenticate(options.challenge);
    const results = await Promise.all([
      ctx.routes.loginVerify(post(assertion, { [PASSKEY_CHALLENGE_COOKIE]: cookie })),
      ctx.routes.loginVerify(post(assertion, { [PASSKEY_CHALLENGE_COOKIE]: cookie })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 401]);
  });

  it("rejects expired challenges", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    ctx.advance(5 * 60 * 1000 + 1);
    const res = await ctx.routes.loginVerify(
      post(authenticator.authenticate(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects unknown credentials, other websites, wrong user handles and cloned authenticators", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const stranger = createSoftwareAuthenticator(ORIGIN, "mallory");
    const attempts = [
      (c: string) => stranger.authenticate(c),
      (c: string) => authenticator.authenticate(c, { origin: "https://evil.example" }),
      (c: string) => authenticator.authenticate(c, { userHandle: "bWFsbG9yeQ" }),
      (c: string) => authenticator.authenticate(c, { counter: 5 }),
      (c: string) => authenticator.authenticate(c, { counter: 3 }),
      () => ({ id: authenticator.id }),
    ];
    const statuses: number[] = [];
    for (const attempt of attempts) {
      const { options, cookie } = await startLogin(ctx);
      const res = await ctx.routes.loginVerify(
        post(attempt(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
      );
      statuses.push(res.status);
      if (res.status !== 204)
        expect(await res.json()).toEqual({
          error: "unauthenticated",
          message: "Sign-in required.",
        });
    }
    expect(statuses).toEqual([401, 401, 401, 204, 401, 401]);
  });

  it("rejects sign-in without a challenge cookie", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    expect((await ctx.routes.loginVerify(post(authenticator.authenticate("abc")))).status).toBe(
      401,
    );
  });
});

describe("passkey edge cases", () => {
  it("accounts without an email use the uid as the passkey name; missing transports are stored as []", async () => {
    const ctx = setup();
    const authenticator = createSoftwareAuthenticator(ORIGIN, "bob");
    const optionsRes = await ctx.routes.registerOptions(
      post(undefined, { [SESSION_COOKIE]: "bob-session" }),
    );
    const options = (await optionsRes.json()) as { challenge: string; user: { name: string } };
    expect(options.user.name).toBe("bob");
    const response = authenticator.register(options.challenge);
    const withoutTransports = {
      clientDataJSON: response.response.clientDataJSON,
      attestationObject: response.response.attestationObject,
    };
    const res = await ctx.routes.registerVerify(
      post(
        { ...response, response: withoutTransports },
        {
          [SESSION_COOKIE]: "bob-session",
          [PASSKEY_CHALLENGE_COOKIE]: challengeCookie(optionsRes),
        },
      ),
    );
    expect(res.status).toBe(204);
    expect((await ctx.store.findById(authenticator.id))?.transports).toEqual([]);
  });

  it("rejects a body that is not JSON", async () => {
    const ctx = setup();
    const { cookie } = await startLogin(ctx);
    const res = await ctx.routes.loginVerify(
      new Request(`${ORIGIN}/api/passkeys/x`, {
        method: "POST",
        body: "{not json",
        headers: { cookie: `${PASSKEY_CHALLENGE_COOKIE}=${cookie}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("denies when a concurrent sign-in already used the same authenticator state (atomic counter)", async () => {
    const memory = createMemoryPasskeyStore();
    const ctx = setup({ store: { ...memory, recordUse: () => Promise.resolve(false) } });
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    const res = await ctx.routes.loginVerify(
      post(authenticator.authenticate(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
    );
    expect(res.status).toBe(401);
    expect(ctx.startSession).not.toHaveBeenCalled();
  });

  it("uses the real clock by default", async () => {
    const ctx = setup({ realClock: true });
    const { options, cookie } = await startLogin(ctx);
    expect(options.challenge).toBeTruthy();
    expect(cookie).toBeTruthy();
  });
});

describe("passkey names", () => {
  it("stores the name typed when adding, cleaned; refuses HTML or a name over 32 characters", async () => {
    const ctx = setup();
    const { authenticator, res } = await registerPasskey(ctx, "  Work   laptop ");
    expect(res.status).toBe(204);
    expect((await ctx.store.findById(authenticator.id))?.name).toBe("Work laptop");
    for (const name of ["<b>x</b>", "x".repeat(33)]) {
      const bad = await registerPasskey(ctx, name);
      expect(bad.res.status).toBe(400);
    }
  });

  it("labels the device from the browser's user agent", () => {
    expect(deviceLabel(CHROME_MAC)).toBe("Chrome · macOS");
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari · iOS");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      ),
    ).toBe("Edge · Windows");
    expect(
      deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"),
    ).toBe("Firefox · Linux");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Linux; Android 15) SamsungBrowser/28.0 Chrome/130 Mobile Safari/537.36",
      ),
    ).toBe("Samsung Internet · Android");
    expect(deviceLabel("Mozilla/5.0 (X11; CrOS x86_64) OPR/110.0")).toBe("Opera · ChromeOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0)")).toBe("Windows");
    expect(deviceLabel(null)).toBe("");
  });

  it("renames only the owner's own passkey, with a signed-in session", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const rename = (body: unknown, session?: string) =>
      ctx.routes.rename(post(body, session ? { [SESSION_COOKIE]: session } : {}));
    expect((await rename({ id: authenticator.id, name: "Phone" })).status).toBe(401);
    expect((await rename({ id: authenticator.id, name: "Phone" }, "bob-session")).status).toBe(400);
    expect((await rename({ id: authenticator.id, name: "" }, "alice-session")).status).toBe(400);
    expect(
      (await rename({ id: authenticator.id, name: "Phone", x: 1 }, "alice-session")).status,
    ).toBe(400);
    expect((await rename({ id: authenticator.id, name: "Phone" }, "alice-session")).status).toBe(
      204,
    );
    expect((await ctx.store.findById(authenticator.id))?.name).toBe("Phone");
  });
});

describe("removing a passkey", () => {
  const remove = (ctx: ReturnType<typeof setup>, body: unknown, session?: string) =>
    ctx.routes.remove(post(body, session ? { [SESSION_COOKIE]: session } : {}));

  it("needs a recent sign-in and the owner's own passkey", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    expect((await remove(ctx, { id: authenticator.id })).status).toBe(401);
    expect((await remove(ctx, { id: authenticator.id }, "bob-session")).status).toBe(400);
    expect((await remove(ctx, { nope: 1 }, "alice-session")).status).toBe(400);
    expect((await remove(ctx, { id: authenticator.id }, "alice-session")).status).toBe(204);
    expect(await ctx.store.findById(authenticator.id)).toBeNull();

    const stale = setup({ authTime: nowSeconds - 60 * 60 });
    expect((await remove(stale, { id: authenticator.id }, "alice-session")).status).toBe(401);
  });

  it("never removes the account's last way to sign in", async () => {
    const ctx = setup({ providers: 0 });
    const first = await registerPasskey(ctx);
    expect((await remove(ctx, { id: first.authenticator.id }, "alice-session")).status).toBe(409);
    const second = await registerPasskey(ctx);
    expect((await remove(ctx, { id: first.authenticator.id }, "alice-session")).status).toBe(204);
    expect((await remove(ctx, { id: second.authenticator.id }, "alice-session")).status).toBe(409);
  });

  it("rejects rename and remove bodies that are not JSON", async () => {
    const ctx = setup();
    const raw = () =>
      new Request(`${ORIGIN}/api/passkeys/x`, {
        method: "POST",
        body: "{not json",
        headers: { cookie: `${SESSION_COOKIE}=alice-session` },
      });
    expect((await ctx.routes.rename(raw())).status).toBe(400);
    expect((await ctx.routes.remove(raw())).status).toBe(400);
  });

  it("reports a passkey removed by a concurrent request as invalid", async () => {
    const memory = createMemoryPasskeyStore();
    const ctx = setup({ store: { ...memory, remove: () => Promise.resolve(false) } });
    const { authenticator } = await registerPasskey(ctx);
    expect((await remove(ctx, { id: authenticator.id }, "alice-session")).status).toBe(400);
  });
});
