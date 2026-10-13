import type { Principal } from "@website/permissions";

/**
 * Port: maps a verified Firebase uid to the user's record + role assignments in Firestore
 * (`users/{uid}`). A valid Firebase login alone grants nothing in admin: without a staff
 * role (one that includes `admin.access`) the admin area is closed.
 * Implemented in @website/db in the next phase.
 */
export interface UserDirectory {
  findPrincipalByUid(uid: string): Promise<Principal | null>;
}

/** Until the directory is implemented, nobody resolves. Fails closed. */
export const denyAllUserDirectory: UserDirectory = {
  findPrincipalByUid: () => Promise.resolve(null),
};
