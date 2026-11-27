import { z } from "zod";
import { jsonError } from "@website/security";
import {
  SESSION_COOKIE,
  type IdentityProvider,
  type SignInProvider,
  type VerifiedIdentity,
} from "./session";
import type { SignIn } from "./sign-in";

const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const Password = z.string().min(8).max(128);
const SignInBody = z.discriminatedUnion("method", [
  z.object({ method: z.literal("google"), credential: z.string().min(1).max(4096) }).strict(),
  z
    .object({ method: z.literal("password"), email: Email, password: z.string().min(1).max(128) })
    .strict(),
  z.object({ method: z.literal("signup"), email: Email, password: Password }).strict(),
  z.object({ method: z.literal("reset-request"), email: Email }).strict(),
  z
    .object({ method: z.literal("reset"), token: z.string().min(1).max(1024), password: Password })
    .strict(),
]);

function cookieHeader(value: string, maxAgeSeconds: number, domain: string | undefined): string {
  const scope = domain ? `; Domain=${domain}` : "";
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/${scope}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

const noContent = { status: 204, headers: { "Cache-Control": "no-store" } };

export function createSessionRoutes(options: {
  identity: IdentityProvider;
  maxAgeHours: number;
  cookieDomain?: string | undefined;
  /** Sign-in methods (web only): without them POST refuses every body. */
  signIn?: SignIn | undefined;
  onSignIn?: ((identity: VerifiedIdentity) => Promise<void>) | undefined;
}) {
  const maxAgeSeconds = options.maxAgeHours * 3600;
  const domain = options.cookieDomain;

  /** Session cookie for a uid whose sign-in was verified just now. */
  async function start(uid: string, provider: SignInProvider): Promise<Response> {
    const cookie = await options.identity.createSession(uid, provider, maxAgeSeconds * 1000);
    const identity = await options.identity.verifySessionCookie(cookie);
    if (!identity) return jsonError("unauthenticated");
    if (options.onSignIn) await options.onSignIn(identity);
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie": cookieHeader(cookie, maxAgeSeconds, domain),
        "Cache-Control": "no-store",
      },
    });
  }

  return {
    start,

    async POST(request: Request): Promise<Response> {
      const parsed = SignInBody.safeParse(await request.json().catch(() => null));
      const signIn = options.signIn;
      if (!parsed.success || !signIn) return jsonError("invalid_input");
      const body = parsed.data;
      switch (body.method) {
        case "google": {
          const uid = await signIn.google(body.credential).catch(() => null);
          return uid ? start(uid, "google.com") : jsonError("unauthenticated");
        }
        case "password": {
          const uid = await signIn.password(body.email, body.password);
          return uid ? start(uid, "password") : jsonError("unauthenticated");
        }
        case "signup": {
          const uid = await signIn.signUp(body.email, body.password);
          return uid ? start(uid, "password") : jsonError("conflict");
        }
        case "reset-request":
          await signIn.requestPasswordReset(body.email);
          return new Response(null, noContent);
        case "reset": {
          const uid = await signIn.resetPassword(body.token, body.password);
          return uid ? start(uid, "password") : jsonError("unauthenticated");
        }
      }
    },

    async DELETE(request: Request): Promise<Response> {
      const cookie = readCookie(request, SESSION_COOKIE);
      const identity = cookie ? await options.identity.verifySessionCookie(cookie) : null;
      if (identity) await options.identity.revokeSessions(identity.uid);
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": cookieHeader("", 0, domain), "Cache-Control": "no-store" },
      });
    },
  };
}
