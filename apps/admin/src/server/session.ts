import "server-only";
import { createIdentityProvider, createSessionRoutes } from "@website/auth";
import { lazyEnv } from "@website/config/env";
import { createSqlAuthAccountStore } from "@website/db/sql";
import { getAdminEnv } from "./env";
import { adminDb } from "./stores";

export const identity = lazyEnv(() =>
  createIdentityProvider({
    secret: getAdminEnv().SESSION_SECRET,
    accounts: createSqlAuthAccountStore(adminDb()),
  }),
);

/** Sign-out only: people sign in on the web app (`signInUrl`). */
export const sessionRoutes = lazyEnv(() => {
  const env = getAdminEnv();
  return createSessionRoutes({
    identity: identity(),
    maxAgeHours: env.SESSION_MAX_AGE_HOURS,
    cookieDomain: env.SESSION_COOKIE_DOMAIN,
  });
});
