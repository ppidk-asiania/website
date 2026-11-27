import { generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createAccountAdmin,
  createAccountCreator,
  createIdentityProvider,
  createSignIn,
  googleKeys,
  hashPassword,
  passwordMatches,
  type AuthAccountStore,
  type LinkKind,
  type NewAuthAccount,
} from "@website/auth";
import { createSqlAuthAccountStore } from "@website/db/sql";
import { signLink } from "@website/security";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlAuthAccountStore>[0];

const SECRET = "x".repeat(32);
const CLIENT_ID = "123-abc.apps.googleusercontent.com";
const NOW = new Date("2026-11-27T10:00:00Z");

const blank: NewAuthAccount = {
  email: null,
  emailVerified: false,
  name: null,
  picture: null,
  google: null,
  passwordHash: null,
  disabled: false,
  sessionsValidAfter: 0,
};

function store() {
  const fake = fakeDb();
  return { accounts: createSqlAuthAccountStore(fake.db as unknown as Db), docs: fake.docs };
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1" } as JsonWebKey;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function googleToken(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const head = b64({ alg: "RS256", kid: "key-1", ...header });
  const body = b64({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: NOW.getTime() / 1000 + 600,
    sub: "1001",
    email: "Ana@Example.org",
    email_verified: true,
    name: "Ana",
    picture: "https://lh3.googleusercontent.com/a",
    ...claims,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

function setup(accounts: AuthAccountStore = store().accounts) {
  const links: Array<{ kind: LinkKind; to: string; token: string }> = [];
  let clock = NOW;
  const now = () => clock;
  const signIn = createSignIn({
    accounts,
    secret: SECRET,
    googleClientId: CLIENT_ID,
    sendLink: (kind, to, token) => {
      links.push({ kind, to, token });
      return Promise.resolve();
    },
    keys: () => Promise.resolve([jwk]),
    now,
  });
  const identity = createIdentityProvider({ secret: SECRET, accounts, now });
  return {
    accounts,
    signIn,
    identity,
    links,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}

describe("account store (authAccounts + unique authLogins)", () => {
  it("keeps e-mail addresses and Google accounts unique, case-insensitively", async () => {
    const { accounts } = store();
    const ana = await accounts.create({ ...blank, uid: "ana", email: "ana@example.org" }, NOW);
    expect(ana).toMatchObject({ uid: "ana", email: "ana@example.org", createdAt: NOW });
    expect(await accounts.create({ ...blank, email: "ana@example.org" }, NOW)).toBeNull();
    expect(await accounts.create({ ...blank, uid: "ana" }, NOW)).toBeNull();
    expect((await accounts.findByEmail("ANA@example.org"))?.uid).toBe("ana");
    const google = { sub: "9", email: "b@example.org", name: null, picture: null };
    const bo = await accounts.create({ ...blank, google }, NOW);
    expect(bo?.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect((await accounts.findByGoogleSub("9"))?.uid).toBe(bo?.uid);
    expect(await accounts.create({ ...blank, google }, NOW)).toBeNull();
    expect(await accounts.findByEmail("nobody@example.org")).toBeNull();
    expect(await accounts.get("nobody")).toBeNull();
  });

  it("moves the login keys when the e-mail or Google account changes, never onto another account", async () => {
    const { accounts } = store();
    await accounts.create({ ...blank, uid: "ana", email: "ana@example.org" }, NOW);
    await accounts.create({ ...blank, uid: "bo", email: "bo@example.org" }, NOW);
    expect(await accounts.update("ana", { email: "bo@example.org" })).toBe(false);
    expect(await accounts.update("ana", { email: "new@example.org" })).toBe(true);
    expect(await accounts.findByEmail("ana@example.org")).toBeNull();
    expect((await accounts.findByEmail("new@example.org"))?.uid).toBe("ana");
    expect(await accounts.update("ana", { name: "Ana" })).toBe(true);
    expect(await accounts.update("gone", { name: "x" })).toBe(false);
  });

  it("finds nothing for a login whose account row is gone, and deletes account and logins together", async () => {
    const { accounts, docs } = store();
    await accounts.create({ ...blank, uid: "ana", email: "ana@example.org" }, NOW);
    docs.delete("authAccounts/ana");
    expect(await accounts.findByEmail("ana@example.org")).toBeNull();
    await accounts.create({ ...blank, uid: "bo", email: "bo@example.org" }, NOW);
    await accounts.delete("bo");
    await accounts.delete("bo");
    expect(await accounts.findByEmail("bo@example.org")).toBeNull();
    expect([...docs.keys()].some((k) => k.includes("bo"))).toBe(false);
  });
});

describe("session cookies (signed, checked against the account on every request)", () => {
  it("round-trips the uid, provider and sign-in time", async () => {
    const { accounts, identity } = setup();
    await accounts.create({ ...blank, uid: "ana", email: "ana@example.org", name: "Ana" }, NOW);
    const cookie = await identity.createSession("ana", "password", 3600_000);
    expect(await identity.verifySessionCookie(cookie)).toEqual({
      uid: "ana",
      email: "ana@example.org",
      name: "Ana",
      picture: null,
      emailVerified: false,
      signInProvider: "password",
      authTime: NOW.getTime() / 1000,
    });
  });

  it("refuses tampered, foreign, expired, revoked and disabled sessions", async () => {
    const { accounts, identity, advance } = setup();
    await accounts.create({ ...blank, uid: "ana" }, NOW);
    const cookie = await identity.createSession("ana", "password", 3600_000);
    const [body, sig] = cookie.split(".");
    const forged = `${b64({ k: "session", uid: "bo", p: "password", at: "0" })}.${sig}`;
    for (const bad of [
      `${body}.x`,
      forged,
      "nonsense",
      signLink({ k: "reset", uid: "ana", at: "1" }, SECRET),
    ]) {
      expect(await identity.verifySessionCookie(bad), bad).toBeNull();
    }
    expect(
      await identity.verifySessionCookie(signLink({ k: "session", uid: "ana" }, SECRET)),
    ).toBeNull();
    expect(
      await identity.verifySessionCookie(signLink({ k: "session", uid: "ana", at: "1" }, SECRET)),
    ).toBeNull();
    expect(
      await identity.verifySessionCookie(
        signLink({ k: "session", uid: "x", p: "password", at: "1" }, SECRET),
      ),
    ).toBeNull();
    advance(1);
    await identity.revokeSessions("ana");
    expect(await identity.verifySessionCookie(cookie)).toBeNull();
    const fresh = await identity.createSession("ana", "password", 3600_000);
    expect(await identity.verifySessionCookie(fresh)).not.toBeNull();
    await accounts.update("ana", { disabled: true });
    expect(await identity.verifySessionCookie(fresh)).toBeNull();
    await accounts.update("ana", { disabled: false });
    advance(3600_001);
    expect(await identity.verifySessionCookie(fresh)).toBeNull();
  });

  it("uses the real clock by default", async () => {
    const { accounts } = store();
    await accounts.create({ ...blank, uid: "ana" }, NOW);
    const identity = createIdentityProvider({ secret: SECRET, accounts });
    const cookie = await identity.createSession("ana", "passkey", 60_000);
    expect((await identity.verifySessionCookie(cookie))?.signInProvider).toBe("passkey");
  });
});

describe("passwords (scrypt)", () => {
  it("matches only the right password and never an account without one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toMatch(/^scrypt\$32768\$/);
    expect(await passwordMatches("correct horse", stored)).toBe(true);
    expect(await passwordMatches("wrong horse", stored)).toBe(false);
    expect(await passwordMatches("anything", null)).toBe(false);
    expect(await passwordMatches("correct horse", stored.replace("32768", "1024"))).toBe(false);
    expect(await passwordMatches("correct horse", "bcrypt$x")).toBe(false);
  });
});

describe("Google sign-in (Google Identity Services ID token)", () => {
  it("creates an account for a new Google user with the proven e-mail", async () => {
    const { signIn, accounts } = setup();
    const uid = await signIn.google(googleToken());
    const account = await accounts.get(uid ?? "");
    expect(account).toMatchObject({
      email: "ana@example.org",
      emailVerified: true,
      name: "Ana",
      google: { sub: "1001", email: "ana@example.org" },
    });
    expect(await signIn.google(googleToken({ name: "Ana B." }))).toBe(uid);
    expect((await accounts.get(uid ?? ""))?.google?.name).toBe("Ana B.");
    const bare = await signIn.google(
      googleToken({ sub: "2002", email: "bo@example.org", name: undefined, picture: undefined }),
    );
    expect(await accounts.get(bare ?? "")).toMatchObject({ name: null, picture: null });
  });

  it("refuses tokens that are not Google's, not for this site, expired or without a proven e-mail", async () => {
    const { signIn } = setup();
    const valid = googleToken();
    const [head, body] = valid.split(".");
    for (const token of [
      googleToken({ aud: "other.apps.googleusercontent.com" }),
      googleToken({ iss: "https://evil.example" }),
      googleToken({ exp: NOW.getTime() / 1000 - 1 }),
      googleToken({ email_verified: false }),
      googleToken({}, { alg: "none" }),
      googleToken({}, { kid: "unknown" }),
      `${head}.${body}.${Buffer.from("forged").toString("base64url")}`,
      `${head}.${b64({ sub: "1" })}.${valid.split(".")[2]}`,
      `${valid}.extra`,
      "not-a-token",
      "%%%.%%%.%%%",
    ]) {
      expect(await signIn.google(token), token.slice(0, 40)).toBeNull();
    }
  });

  it("links Google to the account of the same e-mail; an unproven password is dropped with its sessions", async () => {
    const { signIn, accounts, identity, advance } = setup();
    await accounts.create(
      { ...blank, uid: "ana", email: "ana@example.org", passwordHash: "scrypt$1$a$b", name: "Old" },
      NOW,
    );
    const cookie = await identity.createSession("ana", "password", 3600_000);
    advance(1);
    expect(await signIn.google(googleToken())).toBe("ana");
    const ana = await accounts.get("ana");
    expect(ana).toMatchObject({ emailVerified: true, passwordHash: null, name: "Old" });
    expect(ana?.picture).toBe("https://lh3.googleusercontent.com/a");
    expect(await identity.verifySessionCookie(cookie)).toBeNull();
  });

  it("keeps a proven password when linking, and lets no disabled account in", async () => {
    const { signIn, accounts } = setup();
    await accounts.create(
      {
        ...blank,
        uid: "ana",
        email: "ana@example.org",
        emailVerified: true,
        passwordHash: "h",
        disabled: true,
      },
      NOW,
    );
    expect(await signIn.google(googleToken())).toBeNull();
    expect((await accounts.get("ana"))?.passwordHash).toBe("h");
    expect(await signIn.google(googleToken())).toBeNull();
  });

  it("refuses when the Google account cannot be linked or created", async () => {
    const base = store().accounts;
    const refusing: AuthAccountStore = {
      ...base,
      update: () => Promise.resolve(false),
      create: () => Promise.resolve(null),
    };
    await base.create({ ...blank, uid: "ana", email: "ana@example.org" }, NOW);
    expect(await setup(refusing).signIn.google(googleToken())).toBeNull();
    expect(
      await setup(refusing).signIn.google(googleToken({ email: "new@example.org" })),
    ).toBeNull();
  });
});

describe("Google key set", () => {
  it("is cached for Cache-Control max-age and fetched again afterwards", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "cache-control": "public, max-age=60" },
        }),
      ),
    );
    const keys = googleKeys(fetcher);
    expect(await keys(0)).toEqual([jwk]);
    await keys(59_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await keys(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when Google is unreachable, and sends no cache header to mean no caching", async () => {
    const down = googleKeys(() => Promise.resolve(new Response("", { status: 503 })));
    await expect(down(0)).rejects.toThrow("503");
    const fetcher = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ keys: [] }))));
    const keys = googleKeys(fetcher);
    await keys(0);
    await keys(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("e-mail and password", () => {
  it("signs up once per address, sends a verification link and verifies the address with it", async () => {
    const { signIn, accounts, links } = setup();
    const uid = (await signIn.signUp(" Ana@Example.org ", "correct horse")) ?? "";
    expect(await signIn.signUp("ana@example.org", "other pass")).toBeNull();
    expect(links).toEqual([expect.objectContaining({ kind: "verify", to: "ana@example.org" })]);
    expect(await signIn.verifyEmail("garbage")).toBe(false);
    expect(await signIn.verifyEmail(links[0]?.token ?? "")).toBe(true);
    expect((await accounts.get(uid))?.emailVerified).toBe(true);
    await accounts.update(uid, { email: "changed@example.org" });
    expect(await signIn.verifyEmail(links[0]?.token ?? "")).toBe(false);
  });

  it("signs in with the right password only, case-insensitively, and never a disabled account", async () => {
    const { signIn, accounts } = setup();
    const uid = (await signIn.signUp("ana@example.org", "correct horse")) ?? "";
    expect(await signIn.password("ANA@example.org", "correct horse")).toBe(uid);
    expect(await signIn.password("ana@example.org", "wrong horse")).toBeNull();
    expect(await signIn.password("nobody@example.org", "correct horse")).toBeNull();
    await accounts.update(uid, { disabled: true });
    expect(await signIn.password("ana@example.org", "correct horse")).toBeNull();
  });

  it("resets a password with a one-hour, single-use link that proves the address and ends old sessions", async () => {
    const { signIn, accounts, identity, links, advance } = setup();
    const uid = (await signIn.signUp("ana@example.org", "old password")) ?? "";
    const cookie = await identity.createSession(uid, "password", 3600_000);
    await signIn.requestPasswordReset("nobody@example.org");
    await signIn.requestPasswordReset("ana@example.org");
    const reset = links.find((l) => l.kind === "reset");
    expect(reset?.to).toBe("ana@example.org");
    const verify = links.find((l) => l.kind === "verify")?.token ?? "";
    expect(await signIn.resetPassword(verify, "new password")).toBeNull();
    advance(1);
    expect(await signIn.resetPassword(reset?.token ?? "", "new password")).toBe(uid);
    expect(await signIn.resetPassword(reset?.token ?? "", "third password")).toBeNull();
    expect(await signIn.password("ana@example.org", "new password")).toBe(uid);
    expect((await accounts.get(uid))?.emailVerified).toBe(true);
    expect(await identity.verifySessionCookie(cookie)).toBeNull();
    await signIn.requestPasswordReset("ana@example.org");
    advance(3600_001);
    expect(await signIn.resetPassword(links.at(-1)?.token ?? "", "late password")).toBeNull();
  });

  it("lets an account created without a password (Role Manager, chatbot) set one by reset", async () => {
    const { signIn, accounts, links } = setup();
    await accounts.create({ ...blank, uid: "ana", email: "ana@example.org" }, NOW);
    await signIn.requestPasswordReset("ana@example.org");
    expect(await signIn.resetPassword(links[0]?.token ?? "", "first password")).toBe("ana");
    expect(await signIn.password("ana@example.org", "first password")).toBe("ana");
  });

  it("sends no reset link to a disabled account, and a reset that cannot be saved fails", async () => {
    const base = store().accounts;
    const { signIn, links } = setup(base);
    const uid = (await signIn.signUp("ana@example.org", "old password")) ?? "";
    await signIn.requestPasswordReset("ana@example.org");
    await base.update(uid, { disabled: true });
    await signIn.requestPasswordReset("ana@example.org");
    expect(links.filter((l) => l.kind === "reset")).toHaveLength(1);
    expect(await signIn.resetPassword(links.at(-1)?.token ?? "", "new password")).toBeNull();
    await base.update(uid, { disabled: false });
    const refusing = setup({ ...base, update: () => Promise.resolve(false) });
    expect(
      await refusing.signIn.resetPassword(links.at(-1)?.token ?? "", "new password"),
    ).toBeNull();
  });

  it("uses the real clock and Google's live keys by default", async () => {
    const signIn = createSignIn({
      accounts: store().accounts,
      secret: SECRET,
      googleClientId: CLIENT_ID,
      sendLink: () => Promise.resolve(),
    });
    expect(typeof (await signIn.signUp("a@example.org", "password1"))).toBe("string");
  });
});

describe("account admin (Role Manager, web settings) and account creator", () => {
  it("reports linked providers, disables, revokes, changes e-mail, unlinks and deletes", async () => {
    const { accounts, identity } = setup();
    const google = { sub: "1", email: "g@example.org", name: "G", picture: "p" };
    await accounts.create(
      { ...blank, uid: "ana", email: "ana@example.org", name: "Ana", google, passwordHash: "h" },
      NOW,
    );
    await accounts.create({ ...blank, uid: "bo", email: "bo@example.org" }, NOW);
    let clock = NOW.getTime();
    const admin = createAccountAdmin(accounts, () => new Date((clock += 1)));
    expect(await admin.signInMethods("ana")).toEqual({ providers: ["google.com", "password"] });
    expect(await admin.signInMethods("nobody")).toEqual({ providers: [] });
    expect(await admin.details("ana")).toEqual({
      providers: [
        { providerId: "google.com", email: "g@example.org", name: "G", picture: "p" },
        { providerId: "password", email: "ana@example.org", name: "Ana", picture: null },
      ],
      createdAt: NOW,
    });
    expect(await admin.details("nobody")).toEqual({ providers: [], createdAt: null });
    await admin.setDisabled("ana", true);
    expect((await accounts.get("ana"))?.disabled).toBe(true);
    await admin.setDisabled("ana", false);
    const cookie = await identity.createSession("ana", "password", 3600_000);
    await admin.revokeSessions("ana");
    expect(await identity.verifySessionCookie(cookie)).toBeNull();
    await expect(admin.changeEmail("ana", "bo@example.org")).rejects.toMatchObject({
      code: "email_taken",
    });
    await admin.changeEmail("ana", " Ana2@Example.org ");
    expect(await accounts.get("ana")).toMatchObject({
      email: "ana2@example.org",
      emailVerified: true,
    });
    await admin.unlinkProvider("ana", "google.com");
    await admin.unlinkProvider("ana", "password");
    await admin.unlinkProvider("ana", "other");
    expect((await admin.signInMethods("ana")).providers).toEqual([]);
    await admin.deleteUser("ana");
    expect(await accounts.get("ana")).toBeNull();
    expect(typeof (await createAccountAdmin(accounts).revokeSessions("bo"))).toBe("undefined");
  });

  it("finds or creates the account of an address, also when another request created it first", async () => {
    const base = store().accounts;
    const ensure = createAccountCreator(base, () => NOW);
    const created = await ensure(" Ana@Example.org ", "Ana");
    expect(created.created).toBe(true);
    expect(await ensure("ana@example.org", "Ana")).toEqual({ uid: created.uid, created: false });
    let lookups = 0;
    const racing: AuthAccountStore = {
      ...base,
      findByEmail: (email) => (lookups++ === 0 ? Promise.resolve(null) : base.findByEmail(email)),
    };
    expect(await createAccountCreator(racing)("ana@example.org", "Ana")).toEqual({
      uid: created.uid,
      created: false,
    });
    const broken: AuthAccountStore = {
      ...base,
      findByEmail: () => Promise.resolve(null),
      create: () => Promise.resolve(null),
    };
    await expect(createAccountCreator(broken)("x@example.org", "X")).rejects.toThrow();
  });
});
