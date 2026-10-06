import { ROLE_PERMISSIONS, type Permission, type Role } from "./permissions";

export type Scope =
  { readonly type: "global" } | { readonly type: "chapter"; readonly chapterId: string };

export interface RoleAssignment {
  readonly role: Role;
  readonly scope: Scope;
}

/**
 * The server-side view of who is acting. Built ONLY on the server from a verified
 * session + the staff record in the database — never from client input or token claims.
 */
export interface Principal {
  readonly kind: "staff";
  readonly staffId: string;
  readonly uid: string;
  readonly active: boolean;
  readonly assignments: readonly RoleAssignment[];
}

export interface ResourceContext {
  /** Present when the resource belongs to a chapter; enables scoped roles. */
  readonly chapterId?: string;
}

function scopeCovers(scope: Scope, resource: ResourceContext | undefined): boolean {
  if (scope.type === "global") return true;
  return resource?.chapterId !== undefined && resource.chapterId === scope.chapterId;
}

/** Deny by default. Inactive principals can do nothing. */
export function can(
  principal: Principal | null,
  permission: Permission,
  resource?: ResourceContext,
): boolean {
  if (principal === null || !principal.active) return false;
  return principal.assignments.some(
    (assignment) =>
      ROLE_PERMISSIONS[assignment.role].includes(permission) &&
      scopeCovers(assignment.scope, resource),
  );
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
 * Role-assignment guard: nobody may grant a role that carries permissions they don't hold,
 * and only holders of users.manage may assign roles at all.
 */
export function canAssignRole(principal: Principal | null, role: Role): boolean {
  if (!can(principal, "users.manage")) return false;
  return ROLE_PERMISSIONS[role].every((permission) => can(principal, permission));
}
