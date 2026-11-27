export const SESSION_COOKIE = "__Secure-session";

/** How the session was started. */
export type SignInProvider = "google.com" | "password" | "passkey";

export interface VerifiedIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly name?: string | null;
  readonly picture?: string | null;
  readonly emailVerified: boolean;
  readonly signInProvider: string | null;
  readonly authTime: number;
}

export interface IdentityProvider {
  /** A signed session cookie for a sign-in that was verified just now. */
  createSession(uid: string, signInProvider: SignInProvider, maxAgeMs: number): Promise<string>;
  verifySessionCookie(cookie: string): Promise<VerifiedIdentity | null>;
  revokeSessions(uid: string): Promise<void>;
}

export function isRecentSignIn(
  identity: Pick<VerifiedIdentity, "authTime">,
  nowSeconds: number,
  maxAgeSeconds = 15 * 60,
): boolean {
  return nowSeconds - identity.authTime <= maxAgeSeconds;
}

export interface SignInMethods {
  readonly providers: readonly string[];
  readonly passkeys: number;
}

/** A passkey plus Google or a password. */
export function hasTwoSignInMethods(methods: SignInMethods): boolean {
  return methods.passkeys > 0 && methods.providers.length > 0;
}

export interface AccountAdmin {
  signInMethods(uid: string): Promise<Pick<SignInMethods, "providers">>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  revokeSessions(uid: string): Promise<void>;
}

/** A sign-in provider linked to the account ("google.com" or "password"). */
export interface LinkedProvider {
  readonly providerId: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly picture: string | null;
}

/** What a signed-in person may do to their own account (web settings). */
export interface OwnAccountAdmin {
  details(uid: string): Promise<{ providers: LinkedProvider[]; createdAt: Date | null }>;
  /** Sets a new, already proven e-mail address as the account's sign-in address. */
  changeEmail(uid: string, email: string): Promise<void>;
  unlinkProvider(uid: string, providerId: string): Promise<void>;
  deleteUser(uid: string): Promise<void>;
}

/** The Google account linked to a sign-in account. */
export interface GoogleLink {
  readonly sub: string;
  readonly email: string;
  readonly name: string | null;
  readonly picture: string | null;
}

/** A sign-in account (`authAccounts/{uid}`): the user pool for everyone. */
export interface AuthAccount {
  readonly uid: string;
  /** Lower case; unique across accounts. */
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly picture: string | null;
  readonly google: GoogleLink | null;
  /** `scrypt$…` (see `hashPassword`); null without a password. */
  readonly passwordHash: string | null;
  readonly disabled: boolean;
  /** Sessions started before this time (ms) are refused (sign-out everywhere). */
  readonly sessionsValidAfter: number;
  readonly createdAt: Date;
}

export type NewAuthAccount = Omit<AuthAccount, "uid" | "createdAt"> & { readonly uid?: string };
export type AuthAccountChange = Partial<Omit<AuthAccount, "uid" | "createdAt">>;

/** Port implemented in `@website/db/sql` (`createSqlAuthAccountStore`). */
export interface AuthAccountStore {
  get(uid: string): Promise<AuthAccount | null>;
  findByEmail(email: string): Promise<AuthAccount | null>;
  findByGoogleSub(sub: string): Promise<AuthAccount | null>;
  /** Null when the e-mail address or Google account already belongs to an account. */
  create(account: NewAuthAccount, now: Date): Promise<AuthAccount | null>;
  /** False when the account is gone or a new e-mail / Google account belongs to another one. */
  update(uid: string, change: AuthAccountChange): Promise<boolean>;
  delete(uid: string): Promise<void>;
}
