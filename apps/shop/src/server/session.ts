import "server-only";
import { createIdentityProvider, createSessionRoutes } from "@website/auth";
import { lazyEnv } from "@website/config/env";
import { createSqlAuthAccountStore, getDatabaseForRole } from "@website/db/sql";
import { getShopEnv } from "./env";

/** Sign-out only: people sign in on the web app. */
export const sessionRoutes = lazyEnv(() => {
  const env = getShopEnv();
  const db = getDatabaseForRole({
    role: "shop_rw",
    url: env.DATABASE_URL,
    connectionLimit: env.DATABASE_CONNECTION_LIMIT,
  });
  return createSessionRoutes({
    identity: createIdentityProvider({
      secret: env.SESSION_SECRET,
      accounts: createSqlAuthAccountStore(db),
    }),
    maxAgeHours: env.SESSION_MAX_AGE_HOURS,
    cookieDomain: env.SESSION_COOKIE_DOMAIN,
  });
});
