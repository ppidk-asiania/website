import { randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { z } from "zod";
import { jsonError } from "@website/security";
import { safeText } from "@website/security/validation";
import { readCookie } from "./session-routes";
import { isRecentSignIn, SESSION_COOKIE, type IdentityProvider } from "./session";

export interface PasskeyCredential {
  readonly id: string;
  readonly userId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports: readonly string[];
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  /** Chosen by the owner; empty for passkeys added before names existed. */
  readonly name: string;
  /** Browser and system it was added from, e.g. "Chrome · macOS"; may be empty. */
  readonly device: string;
}

export interface PasskeyChallenge {
  readonly challenge: string;
  readonly userId: string | null;
  readonly expiresAt: Date;
}

export interface PasskeyStore {
  listByUser(userId: string): Promise<PasskeyCredential[]>;
  findById(credentialId: string): Promise<PasskeyCredential | null>;
  add(credential: PasskeyCredential): Promise<void>;
  recordUse(credentialId: string, newCounter: number, usedAt: Date): Promise<boolean>;
  /** Both return false unless the credential exists and belongs to `userId`. */
  rename(credentialId: string, userId: string, name: string): Promise<boolean>;
  remove(credentialId: string, userId: string): Promise<boolean>;
  saveChallenge(id: string, challenge: PasskeyChallenge): Promise<void>;
  consumeChallenge(id: string, now: Date): Promise<PasskeyChallenge | null>;
}

export const PASSKEY_CHALLENGE_COOKIE = "__Host-passkey-challenge";
const CHALLENGE_TTL_SECONDS = 300;

export const PASSKEY_NAME_MAX = 32;
const PasskeyName = safeText(PASSKEY_NAME_MAX);
const NamedBody = z.object({ name: PasskeyName.optional() });
const CredentialIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1400}$/);
const RenameBody = z.object({ id: CredentialIdSchema, name: PasskeyName }).strict();
const RemoveBody = z.object({ id: CredentialIdSchema }).strict();

/** "Chrome · macOS" from a User-Agent; "" when nothing is recognised. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser = [
    [/Edg(e|A|iOS)?\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/SamsungBrowser\//, "Samsung Internet"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/Chrome\/|CriOS\//, "Chrome"],
    [/Safari\//, "Safari"],
  ].find(([pattern]) => (pattern as RegExp).test(ua))?.[1];
  const system = [
    [/Windows/, "Windows"],
    [/Android/, "Android"],
    [/iPhone|iPad|iPod/, "iOS"],
    [/CrOS/, "ChromeOS"],
    [/Mac OS X|Macintosh/, "macOS"],
    [/Linux/, "Linux"],
  ].find(([pattern]) => (pattern as RegExp).test(ua))?.[1];
  return [browser, system].filter(Boolean).join(" · ");
}

const CredentialResponse = z.object({
  id: CredentialIdSchema,
  rawId: z.string(),
  type: z.literal("public-key"),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
});

function challengeCookie(value: string, maxAge: number): string {
  return `${PASSKEY_CHALLENGE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

const noStore = { "Cache-Control": "no-store" };

export function createPasskeyRoutes(options: {
  store: PasskeyStore;
  identity: IdentityProvider;
  rpName: string;
  origin: string;
  /** Sign-in providers (Google, password) of the account: a passkey is never its last way in. */
  providerCount: (uid: string) => Promise<number>;
  /** Session response for the passkey's owner (`createSessionRoutes(...).start`). */
  startSession: (uid: string) => Promise<Response>;
  now?: () => Date;
}) {
  const { store, identity } = options;
  const rpID = new URL(options.origin).hostname;
  const now = () => options.now?.() ?? new Date();

  async function signedInUser(request: Request) {
    const cookie = readCookie(request, SESSION_COOKIE);
    return cookie ? identity.verifySessionCookie(cookie) : null;
  }

  async function issueChallenge(challenge: string, userId: string | null): Promise<string> {
    const id = randomUUID();
    const expiresAt = new Date(now().getTime() + CHALLENGE_TTL_SECONDS * 1000);
    await store.saveChallenge(id, { challenge, userId, expiresAt });
    return challengeCookie(id, CHALLENGE_TTL_SECONDS);
  }

  async function takeChallenge(request: Request): Promise<PasskeyChallenge | null> {
    const id = readCookie(request, PASSKEY_CHALLENGE_COOKIE);
    return id ? store.consumeChallenge(id, now()) : null;
  }

  async function body(request: Request) {
    const json: unknown = await request.json().catch(() => null);
    return { credential: CredentialResponse.safeParse(json), json };
  }

  const done = (response: Response) => {
    response.headers.append("Set-Cookie", challengeCookie("", 0));
    return response;
  };

  return {
    async registerOptions(request: Request): Promise<Response> {
      const user = await signedInUser(request);
      if (!user || !isRecentSignIn(user, now().getTime() / 1000))
        return jsonError("unauthenticated");
      const existing = await store.listByUser(user.uid);
      const creationOptions = await generateRegistrationOptions({
        rpName: options.rpName,
        rpID,
        userName: user.email ?? user.uid,
        userID: isoUint8Array.fromUTF8String(user.uid),
        attestationType: "none",
        excludeCredentials: existing.map((c) => ({ id: c.id, transports: [...c.transports] })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      });
      const cookie = await issueChallenge(creationOptions.challenge, user.uid);
      return Response.json(creationOptions, { headers: { ...noStore, "Set-Cookie": cookie } });
    },

    async registerVerify(request: Request): Promise<Response> {
      const user = await signedInUser(request);
      if (!user) return jsonError("unauthenticated");
      const challenge = await takeChallenge(request);
      const { credential: parsed, json } = await body(request);
      const named = NamedBody.safeParse(json);
      if (!challenge || challenge.userId !== user.uid || !parsed.success || !named.success) {
        return done(jsonError("invalid_input"));
      }
      const result = await verifyRegistrationResponse({
        response: parsed.data as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: options.origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      }).catch(() => null);
      if (!result?.verified) return done(jsonError("invalid_input"));
      const { credential } = result.registrationInfo;
      const transports = parsed.data.response["transports"];
      await store.add({
        id: credential.id,
        userId: user.uid,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: Array.isArray(transports)
          ? transports.filter((t) => typeof t === "string")
          : [],
        createdAt: now(),
        lastUsedAt: null,
        device: deviceLabel(request.headers.get("user-agent")),
        name: named.data.name ?? "",
      });
      return done(new Response(null, { status: 204, headers: noStore }));
    },

    async loginOptions(_request?: Request): Promise<Response> {
      const requestOptions = await generateAuthenticationOptions({
        rpID,
        userVerification: "required",
      });
      const cookie = await issueChallenge(requestOptions.challenge, null);
      return Response.json(requestOptions, { headers: { ...noStore, "Set-Cookie": cookie } });
    },

    async loginVerify(request: Request): Promise<Response> {
      const challenge = await takeChallenge(request);
      const { credential: parsed } = await body(request);
      const denied = () => done(jsonError("unauthenticated"));
      if (!challenge || challenge.userId !== null || !parsed.success) return denied();
      const stored = await store.findById(parsed.data.id);
      if (!stored) return denied();
      const response = parsed.data as unknown as AuthenticationResponseJSON;
      if (
        response.response.userHandle !== undefined &&
        response.response.userHandle !== isoBase64URL.fromUTF8String(stored.userId)
      ) {
        return denied();
      }
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: options.origin,
        expectedRPID: rpID,
        credential: {
          id: stored.id,
          publicKey: isoBase64URL.toBuffer(stored.publicKey),
          counter: stored.counter,
          transports: [...stored.transports],
        },
        requireUserVerification: true,
      }).catch(() => null);
      if (!result?.verified) return denied();
      if (!(await store.recordUse(stored.id, result.authenticationInfo.newCounter, now())))
        return denied();
      return done(await options.startSession(stored.userId));
    },

    async rename(request: Request): Promise<Response> {
      const user = await signedInUser(request);
      if (!user) return jsonError("unauthenticated");
      const parsed = RenameBody.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return jsonError("invalid_input");
      const renamed = await store.rename(parsed.data.id, user.uid, parsed.data.name);
      return renamed
        ? new Response(null, { status: 204, headers: noStore })
        : jsonError("invalid_input");
    },

    /** Removing a way to sign in is sensitive: recent sign-in, and never the account's last way in. */
    async remove(request: Request): Promise<Response> {
      const user = await signedInUser(request);
      if (!user || !isRecentSignIn(user, now().getTime() / 1000))
        return jsonError("unauthenticated");
      const parsed = RemoveBody.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return jsonError("invalid_input");
      const [mine, providers] = await Promise.all([
        store.listByUser(user.uid),
        options.providerCount(user.uid),
      ]);
      if (!mine.some((c) => c.id === parsed.data.id)) return jsonError("invalid_input");
      if (mine.length === 1 && providers === 0) return jsonError("conflict");
      const removed = await store.remove(parsed.data.id, user.uid);
      return removed
        ? new Response(null, { status: 204, headers: noStore })
        : jsonError("invalid_input");
    },
  };
}
