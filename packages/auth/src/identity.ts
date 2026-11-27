import { signLink, verifyLink } from "@website/security";
import type {
  AccountAdmin,
  AuthAccount,
  AuthAccountStore,
  IdentityProvider,
  LinkedProvider,
  OwnAccountAdmin,
} from "./session";

export const GOOGLE_PROVIDER = "google.com";
export const PASSWORD_PROVIDER = "password";

/**
 * Sessions are signed cookies (`signLink`, `SESSION_SECRET`, the same on web, admin and store).
 * Every check reads the account, so disabling it or signing out everywhere ends them at once.
 */
export function createIdentityProvider(options: {
  secret: string;
  accounts: AuthAccountStore;
  now?: () => Date;
}): IdentityProvider {
  const { secret, accounts } = options;
  const now = () => options.now?.() ?? new Date();
  return {
    createSession(uid, signInProvider, maxAgeMs) {
      const at = now().getTime();
      return Promise.resolve(
        signLink(
          { k: "session", uid, p: signInProvider, at: String(at) },
          secret,
          new Date(at + maxAgeMs),
        ),
      );
    },

    async verifySessionCookie(cookie) {
      const data = verifyLink(cookie, secret, now());
      const at = Number(data?.["at"]);
      if (data?.["k"] !== "session" || !data["uid"] || !data["p"] || !Number.isFinite(at)) {
        return null;
      }
      const account = await accounts.get(data["uid"]);
      if (!account || account.disabled || at < account.sessionsValidAfter) return null;
      return {
        uid: account.uid,
        email: account.email,
        name: account.name,
        picture: account.picture,
        emailVerified: account.emailVerified,
        signInProvider: data["p"],
        authTime: Math.floor(at / 1000),
      };
    },

    async revokeSessions(uid) {
      await accounts.update(uid, { sessionsValidAfter: now().getTime() });
    },
  };
}

function providersOf(account: AuthAccount): LinkedProvider[] {
  return [
    ...(account.google
      ? [
          {
            providerId: GOOGLE_PROVIDER,
            email: account.google.email,
            name: account.google.name,
            picture: account.google.picture,
          },
        ]
      : []),
    ...(account.passwordHash
      ? [{ providerId: PASSWORD_PROVIDER, email: account.email, name: account.name, picture: null }]
      : []),
  ];
}

export function createAccountAdmin(
  accounts: AuthAccountStore,
  now: () => Date = () => new Date(),
): AccountAdmin & OwnAccountAdmin {
  return {
    async signInMethods(uid) {
      const account = await accounts.get(uid);
      return { providers: account ? providersOf(account).map((p) => p.providerId) : [] };
    },
    async setDisabled(uid, disabled) {
      await accounts.update(uid, { disabled });
    },
    async revokeSessions(uid) {
      await accounts.update(uid, { sessionsValidAfter: now().getTime() });
    },
    async details(uid) {
      const account = await accounts.get(uid);
      return {
        providers: account ? providersOf(account) : [],
        createdAt: account?.createdAt ?? null,
      };
    },
    async changeEmail(uid, email) {
      const changed = await accounts.update(uid, {
        email: email.trim().toLowerCase(),
        emailVerified: true,
        sessionsValidAfter: now().getTime(),
      });
      if (!changed)
        throw Object.assign(new Error("E-mail address in use."), { code: "email_taken" });
    },
    async unlinkProvider(uid, providerId) {
      if (providerId === GOOGLE_PROVIDER) await accounts.update(uid, { google: null });
      if (providerId === PASSWORD_PROVIDER) await accounts.update(uid, { passwordHash: null });
    },
    deleteUser(uid) {
      return accounts.delete(uid);
    },
  };
}

/** The account of an e-mail address, created without a way to sign in when there is none. */
export function createAccountCreator(
  accounts: AuthAccountStore,
  now: () => Date = () => new Date(),
) {
  return async (email: string, name: string): Promise<{ uid: string; created: boolean }> => {
    const address = email.trim().toLowerCase();
    const found = await accounts.findByEmail(address);
    if (found) return { uid: found.uid, created: false };
    const created = await accounts.create(
      {
        email: address,
        emailVerified: false,
        name,
        picture: null,
        google: null,
        passwordHash: null,
        disabled: false,
        sessionsValidAfter: 0,
      },
      now(),
    );
    if (created) return { uid: created.uid, created: true };
    const raced = await accounts.findByEmail(address);
    if (!raced) throw new Error("Could not create the account.");
    return { uid: raced.uid, created: false };
  };
}
