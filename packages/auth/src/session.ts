/**
 * Session cookie policy. There is ONE Firebase Auth user pool for everyone (staff, members,
 * customers), but each app keeps its own session cookie:
 * `__Host-` prefix => Secure, Path=/, no Domain, so a cookie set by admin.example.org is
 * never sent to web/shop/api, and a stolen shop session cannot be replayed against admin.
 */
export const SESSION_COOKIE = "__Host-session";

/** Verified identity. Says WHO someone is — never what they may do (that is RBAC, from Firestore). */
export interface VerifiedIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly signInProvider: string | null;
  /** Seconds since epoch of the last real sign-in; used for re-auth on sensitive actions. */
  readonly authTime: number;
}

/**
 * Identity provider port. Firebase today; the rest of the website depends only on this.
 */
export interface IdentityProvider {
  /** Exchanges a fresh ID token (from the client SDK) for a server session cookie. */
  createSessionCookie(idToken: string, maxAgeMs: number): Promise<string>;
  /** Verifies the cookie AND checks revocation. Returns null when invalid/revoked. */
  verifySessionCookie(cookie: string): Promise<VerifiedIdentity | null>;
  revokeSessions(uid: string): Promise<void>;
  /** Short-lived token the browser exchanges for a Firebase sign-in (used after a passkey login). */
  createCustomToken(uid: string): Promise<string>;
}

/** Sensitive actions (role changes, exports, refunds) require a recent sign-in. */
export function isRecentSignIn(
  identity: VerifiedIdentity,
  nowSeconds: number,
  maxAgeSeconds = 15 * 60,
): boolean {
  return nowSeconds - identity.authTime <= maxAgeSeconds;
}
