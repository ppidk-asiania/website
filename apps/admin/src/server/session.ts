import "server-only";
import { createSessionRoutes } from "@website/auth";
import { createFirebaseIdentityProvider } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import { getAdminEnv } from "./env";

export const sessionRoutes = lazyEnv(() => {
  const env = getAdminEnv();
  return createSessionRoutes({
    identity: createFirebaseIdentityProvider({
      appEnv: env.APP_ENV,
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
      authEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST,
    }),
    maxAgeHours: env.SESSION_MAX_AGE_HOURS,
  });
});
