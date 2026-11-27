import "server-only";
import { createAccountAdmin, createPasskeyRoutes, type SignInMethods } from "@website/auth";
import { lazyEnv } from "@website/config/env";
import { createSqlPasskeyStore } from "@website/db/sql";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { authAccounts, identity, sessionRoutes } from "./session";

export const passkeyStore = lazyEnv(() => createSqlPasskeyStore(webDb()));

export const passkeyRoutes = lazyEnv(() => {
  const env = getWebEnv();
  if (!env.WEB_URL) throw new Error("WEB_URL is required for passkeys.");
  return createPasskeyRoutes({
    store: passkeyStore(),
    identity: identity(),
    rpName: "PPIDK Asia-Oseania",
    origin: env.WEB_URL,
    providerCount: async (uid) => (await accountAdmin().signInMethods(uid)).providers.length,
    startSession: (uid) => sessionRoutes().start(uid, "passkey"),
  });
});

export const accountAdmin = lazyEnv(() => createAccountAdmin(authAccounts()));

export async function ownSignInMethods(uid: string): Promise<SignInMethods> {
  const [methods, passkeys] = await Promise.all([
    accountAdmin().signInMethods(uid),
    passkeyStore().listByUser(uid),
  ]);
  return { ...methods, passkeys: passkeys.length };
}
