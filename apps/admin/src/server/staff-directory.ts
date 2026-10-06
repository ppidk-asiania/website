import type { Principal } from "@platform/permissions";

/**
 * Port: maps a verified Firebase uid to a staff record + role assignments from the DATABASE.
 * A valid Firebase login alone grants nothing — no staff row, no access.
 * Implemented in @platform/db in the next phase.
 */
export interface StaffDirectory {
  findPrincipalByUid(uid: string): Promise<Principal | null>;
}

/** Until the directory is implemented, nobody is staff. Fails closed. */
export const denyAllStaffDirectory: StaffDirectory = {
  findPrincipalByUid: () => Promise.resolve(null),
};
