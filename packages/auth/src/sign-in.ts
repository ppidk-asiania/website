import {
  createHash,
  createPublicKey,
  randomBytes,
  scrypt,
  timingSafeEqual,
  verify,
  type JsonWebKey,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { signLink, verifyLink } from "@website/security";
import type { AuthAccount, AuthAccountStore, GoogleLink } from "./session";

const SCRYPT_N = 32768;
const KEY_LENGTH = 64;

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const derive = (password: string, salt: Buffer, n: number) =>
  scryptAsync(password, salt, KEY_LENGTH, { N: n, r: 8, p: 1, maxmem: 256 * n * 8 });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT_N);
  return `scrypt$${SCRYPT_N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// Hashed when an account has no password, so a missing account takes as long as a wrong password.
const NO_PASSWORD = `scrypt$${SCRYPT_N}$${"A".repeat(22)}$${"A".repeat(86)}`;

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const [kind, n, salt = "", key = ""] = (stored ?? NO_PASSWORD).split("$");
  if (kind !== "scrypt" || Number(n) !== SCRYPT_N) return false;
  const derived = await derive(password, Buffer.from(salt, "base64url"), SCRYPT_N);
  const expected = Buffer.from(key, "base64url");
  return (
    stored !== null && expected.length === derived.length && timingSafeEqual(derived, expected)
  );
}

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";

export type GoogleKeys = (nowMs: number) => Promise<JsonWebKey[]>;

/** Google's public sign-in keys, cached as long as Google says (Cache-Control max-age). */
export function googleKeys(fetcher: typeof fetch = fetch): GoogleKeys {
  let cached: { keys: JsonWebKey[]; until: number } | null = null;
  return async (nowMs) => {
    if (cached && cached.until > nowMs) return cached.keys;
    const response = await fetcher(GOOGLE_CERTS);
    if (!response.ok) throw new Error(`Google keys: HTTP ${response.status}`);
    const maxAge = Number(
      /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 0,
    );
    const { keys } = (await response.json()) as { keys: JsonWebKey[] };
    cached = { keys, until: nowMs + maxAge * 1000 };
    return keys;
  };
}

const GoogleHeader = z.object({ alg: z.literal("RS256"), kid: z.string().min(1) });
const GoogleClaims = z.object({
  iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
  aud: z.string(),
  exp: z.number(),
  sub: z.string().min(1).max(255),
  email: z.email(),
  email_verified: z.literal(true),
  name: z.string().optional(),
  picture: z.string().optional(),
});

const decodePart = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

/** A Google Identity Services ID token (the "credential"), checked as Google documents it. */
export async function verifyGoogleIdToken(
  token: string,
  options: { clientId: string; keys: GoogleKeys; nowMs: number },
): Promise<GoogleLink | null> {
  const [head = "", body = "", signature = "", extra] = token.split(".");
  if (extra !== undefined) return null;
  const header = GoogleHeader.safeParse(decodePart(head));
  if (!header.success) return null;
  const jwk = (await options.keys(options.nowMs)).find((k) => k["kid"] === header.data.kid);
  if (!jwk) return null;
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(signature, "base64url"),
  );
  const claims = GoogleClaims.safeParse(decodePart(body));
  if (!signed || !claims.success) return null;
  const c = claims.data;
  if (c.aud !== options.clientId || c.exp * 1000 < options.nowMs) return null;
  return {
    sub: c.sub,
    email: c.email.toLowerCase(),
    name: c.name ?? null,
    picture: c.picture ?? null,
  };
}

export type LinkKind = "verify" | "reset";

const VERIFY_TTL_MS = 3 * 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;
// A reset link stops working once the password it was sent for has changed.
const passwordStamp = (account: AuthAccount) =>
  createHash("sha256")
    .update(account.passwordHash ?? "none")
    .digest("base64url")
    .slice(0, 16);

/** E-mail + password and Google sign-in. Each method returns the uid to start a session for. */
export function createSignIn(options: {
  accounts: AuthAccountStore;
  secret: string;
  googleClientId: string;
  /** Sends the verification or reset link carrying `token`; delivery failures must not throw. */
  sendLink: (kind: LinkKind, to: string, token: string) => Promise<void>;
  keys?: GoogleKeys;
  now?: () => Date;
}) {
  const { accounts, secret } = options;
  const keys = options.keys ?? googleKeys();
  const now = () => options.now?.() ?? new Date();
  const expires = (ms: number) => new Date(now().getTime() + ms);
  const accountOf = async (kind: LinkKind, token: string): Promise<AuthAccount | null> => {
    const data = verifyLink(token, secret, now());
    if (data?.["k"] !== kind || !data["uid"]) return null;
    const account = await accounts.get(data["uid"]);
    if (!account || account.disabled) return null;
    const current =
      kind === "verify" ? account.email === data["e"] : passwordStamp(account) === data["s"];
    return current ? account : null;
  };

  return {
    async google(credential: string): Promise<string | null> {
      const link = await verifyGoogleIdToken(credential, {
        clientId: options.googleClientId,
        keys,
        nowMs: now().getTime(),
      });
      if (!link) return null;
      const known = await accounts.findByGoogleSub(link.sub);
      if (known) {
        await accounts.update(known.uid, { google: link });
        return known.disabled ? null : known.uid;
      }
      const sameEmail = await accounts.findByEmail(link.email);
      if (sameEmail) {
        // Google proved the address. A password set by someone who never proved it is dropped,
        // with its sessions, so it cannot be used to get into this account.
        const linked = await accounts.update(sameEmail.uid, {
          google: link,
          emailVerified: true,
          name: sameEmail.name ?? link.name,
          picture: sameEmail.picture ?? link.picture,
          ...(sameEmail.emailVerified
            ? {}
            : { passwordHash: null, sessionsValidAfter: now().getTime() }),
        });
        return linked && !sameEmail.disabled ? sameEmail.uid : null;
      }
      const created = await accounts.create(
        {
          email: link.email,
          emailVerified: true,
          name: link.name,
          picture: link.picture,
          google: link,
          passwordHash: null,
          disabled: false,
          sessionsValidAfter: 0,
        },
        now(),
      );
      return created?.uid ?? null;
    },

    async password(email: string, password: string): Promise<string | null> {
      const account = await accounts.findByEmail(email.trim().toLowerCase());
      const matches = await passwordMatches(password, account?.passwordHash ?? null);
      return account && matches && !account.disabled ? account.uid : null;
    },

    /** Null when the address already has an account. */
    async signUp(email: string, password: string): Promise<string | null> {
      const address = email.trim().toLowerCase();
      const account = await accounts.create(
        {
          email: address,
          emailVerified: false,
          name: null,
          picture: null,
          google: null,
          passwordHash: await hashPassword(password),
          disabled: false,
          sessionsValidAfter: 0,
        },
        now(),
      );
      if (!account) return null;
      const token = signLink(
        { k: "verify", uid: account.uid, e: address },
        secret,
        expires(VERIFY_TTL_MS),
      );
      await options.sendLink("verify", address, token);
      return account.uid;
    },

    /** Says nothing about whether the address has an account. */
    async requestPasswordReset(email: string): Promise<void> {
      const account = await accounts.findByEmail(email.trim().toLowerCase());
      if (!account?.email || account.disabled) return;
      const stamp = passwordStamp(account);
      const token = signLink(
        { k: "reset", uid: account.uid, s: stamp },
        secret,
        expires(RESET_TTL_MS),
      );
      await options.sendLink("reset", account.email, token);
    },

    /** Sets the new password and ends every other session; the reset proves the address. */
    async resetPassword(token: string, password: string): Promise<string | null> {
      const account = await accountOf("reset", token);
      if (!account) return null;
      const changed = await accounts.update(account.uid, {
        passwordHash: await hashPassword(password),
        emailVerified: true,
        sessionsValidAfter: now().getTime(),
      });
      return changed ? account.uid : null;
    },

    async verifyEmail(token: string): Promise<boolean> {
      const account = await accountOf("verify", token);
      return account ? accounts.update(account.uid, { emailVerified: true }) : false;
    },
  };
}

export type SignIn = ReturnType<typeof createSignIn>;
