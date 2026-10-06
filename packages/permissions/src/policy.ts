import { ROLE_PERMISSIONS, type Permission, type Role } from "./permissions";

export type Scope =
  { readonly type: "global" } | { readonly type: "chapter"; readonly chapterId: string };

export interface RoleAssignment {
  readonly role: Role;
  readonly scope: Scope;
}

/**
 * The server-side view of who is acting. One shape for every account (staff, member,
 * customer). Built ONLY on the server from a verified session + the user record in
 * Firestore — never from client input, URL params, payload fields or token claims.
 */
export interface Principal {
  readonly kind: "user";
  /** Firebase Auth uid; also the Firestore document id in `users`. */
  readonly userId: string;
  readonly active: boolean;
  readonly assignments: readonly RoleAssignment[];
}

export interface ResourceContext {
  /** Present when the resource belongs to a chapter; enables scoped roles. */
  readonly chapterId?: string;
  /** Present for user-owned resources; required by `*_own` permissions. */
  readonly ownerId?: string;
}

function scopeCovers(scope: Scope, resource: ResourceContext | undefined): boolean {
  if (scope.type === "global") return true;
  return resource?.chapterId !== undefined && resource.chapterId === scope.chapterId;
}

const isOwnPermission = (permission: Permission) => permission.endsWith("_own");

/** Deny by default. Inactive principals can do nothing. */
export function can(
  principal: Principal | null,
  permission: Permission,
  resource?: ResourceContext,
): boolean {
  if (principal === null || !principal.active) return false;
  if (isOwnPermission(permission)) {
    // Ownership, not scope, governs *_own permissions.
    if (resource?.ownerId === undefined || resource.ownerId !== principal.userId) return false;
    return principal.assignments.some((a) => ROLE_PERMISSIONS[a.role].includes(permission));
  }
  return principal.assignments.some(
    (assignment) =>
      ROLE_PERMISSIONS[assignment.role].includes(permission) &&
      scopeCovers(assignment.scope, resource),
  );
}

/** True when the principal may enter the admin area at all (any staff role). */
export function canAccessAdmin(principal: Principal | null): boolean {
  if (principal === null || !principal.active) return false;
  return principal.assignments.some((a) => ROLE_PERMISSIONS[a.role].includes("admin.access"));
}

export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
  }
}

export class UnauthenticatedError extends Error {
  override readonly name = "UnauthenticatedError";
  constructor() {
    super("Authentication required");
  }
}

/** Throwing variant for server handlers. */
export function requirePermission(
  principal: Principal | null,
  permission: Permission,
  resource?: ResourceContext,
): asserts principal is Principal {
  if (principal === null || !principal.active) throw new UnauthenticatedError();
  if (!can(principal, permission, resource)) throw new ForbiddenError(permission);
}

/**
 * Role-assignment guard: only holders of users.manage may assign roles, never a role
 * carrying permissions they don't hold themselves (no privilege escalation).
 */
export function canAssignRole(principal: Principal | null, role: Role): boolean {
  if (!can(principal, "users.manage")) return false;
  return ROLE_PERMISSIONS[role]
    .filter((permission) => !isOwnPermission(permission))
    .every((permission) => can(principal, permission));
}

/** Roles every new account receives on first sign-in. */
export const DEFAULT_ROLE_ASSIGNMENTS: readonly RoleAssignment[] = [
  { role: "user", scope: { type: "global" } },
];
