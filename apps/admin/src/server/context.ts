import "server-only";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@platform/auth";
import { createFirebaseIdentityProvider } from "@platform/auth/firebase-admin";
import type { Principal } from "@platform/permissions";
import { getAdminEnv } from "./env";
import { denyAllStaffDirectory, type StaffDirectory } from "./staff-directory";

const staffDirectory: StaffDirectory = denyAllStaffDirectory;

/**
 * Resolves the current principal on the server for every request:
 * session cookie → Firebase verification (with revocation check) → staff record in DB.
 * Never trusts client state, token claims, URL params or payload role fields.
 */
export async function getPrincipal(): Promise<Principal | null> {
  const cookie = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  if (!cookie) return null;

  const env = getAdminEnv();
  const identity = await createFirebaseIdentityProvider({
    appEnv: env.APP_ENV,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
    authEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST,
  }).verifySessionCookie(cookie);
  if (!identity) return null;

  return staffDirectory.findPrincipalByUid(identity.uid);
}
