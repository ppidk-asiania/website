import {
  ADMIN_PAGES,
  PAGE_PERMISSIONS,
  isPagePermission,
  isWebsiteRole,
  type RoleAssignment,
} from "@website/permissions";

export const DEFAULT_ROLE_ID = "visitor";

export type PersonStatus = "active" | "inactive" | "invited";

export interface PersonRow {
  readonly id: string;
  readonly uid: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly status: PersonStatus;
  readonly version: number;
  readonly createdAt: string | null;
  readonly lastSignInAt: string | null;
  readonly roleId: string | null;
  readonly orgRoleIds: readonly string[];
}

interface AccountLike {
  readonly uid: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly status: "active" | "inactive";
  readonly version: number;
  readonly createdAt: Date | null;
  readonly lastSignInAt: Date | null;
  readonly roleAssignments: readonly RoleAssignment[];
}

export function personRow(user: AccountLike): PersonRow {
  const active = user.roleAssignments.filter((a) => !a.revokedAt && a.roleId !== DEFAULT_ROLE_ID);
  return {
    id: user.uid,
    uid: user.uid,
    name: user.name ?? user.email ?? user.uid,
    email: user.email,
    status: user.status,
    version: user.version,
    createdAt: user.createdAt?.toISOString() ?? null,
    lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
    roleId: active.find(isWebsiteRole)?.roleId ?? null,
    orgRoleIds: [...new Set(active.filter((a) => !isWebsiteRole(a)).map((a) => a.roleId))],
  };
}

export function inviteRow(invite: {
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly createdAt: Date | null;
}): PersonRow {
  return {
    id: `invite:${invite.email}`,
    uid: null,
    name: invite.email,
    email: invite.email,
    status: "invited",
    version: 0,
    createdAt: invite.createdAt?.toISOString() ?? null,
    lastSignInAt: null,
    roleId: invite.roleIds[0] ?? null,
    orgRoleIds: [],
  };
}

export function matchesPerson(row: PersonRow, filter: { tab: string; query: string }): boolean {
  const query = filter.query.trim().toLowerCase();
  return (
    (filter.tab === "all" || row.roleId === filter.tab) &&
    (query === "" ||
      row.name.toLowerCase().includes(query) ||
      (row.email ?? "").toLowerCase().includes(query))
  );
}

export function roleTabs(
  rows: readonly PersonRow[],
  roles: readonly { id: string; name: string }[],
): { key: string; label: string; count: number }[] {
  const count = (id: string) => rows.filter((r) => r.roleId === id).length;
  return [
    { key: "all", label: "All", count: rows.length },
    ...roles
      .filter((role) => role.id !== DEFAULT_ROLE_ID && count(role.id) > 0)
      .map((role) => ({ key: role.id, label: role.name, count: count(role.id) })),
  ];
}

export type PersonSortKey = "name" | "role" | "status" | "lastSignIn";

export function personSortValue(
  row: PersonRow,
  key: PersonSortKey,
  roleNames: ReadonlyMap<string, string>,
): string {
  if (key === "name") return row.name.toLowerCase();
  if (key === "status") return row.status;
  if (key === "lastSignIn") return row.lastSignInAt ?? "";
  return row.roleId === null ? "" : (roleNames.get(row.roleId) ?? row.roleId).toLowerCase();
}

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function roleInk(hex: string): "dark" | "light" {
  const luminance = 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  return luminance > 0.179 ? "dark" : "light";
}

export function matchesRole(
  role: { readonly name: string; readonly permissions: readonly string[] },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  return (
    q === "" ||
    role.name.toLowerCase().includes(q) ||
    role.permissions.some((p) => p.toLowerCase().includes(q))
  );
}

const title = (key: string) =>
  key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export interface PermissionGroup {
  readonly page: string;
  readonly label: string;
  readonly permissions: readonly { readonly value: string; readonly label: string }[];
}

export function permissionGroups(): PermissionGroup[] {
  return Object.entries(ADMIN_PAGES).map(
    ([page, definition]: [string, { label: string; extras?: Record<string, string> }]) => ({
      page,
      label: definition.label,
      permissions: ["read", "edit", ...Object.keys(definition.extras ?? {})].map((action) => ({
        value: `${page}.${action}`,
        label: `${title(page)} ${title(action)}`,
      })),
    }),
  );
}

export function filterPermissionGroups(
  groups: readonly PermissionGroup[],
  query: string,
): PermissionGroup[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...groups];
  const matches = (text: string) => text.toLowerCase().includes(q);
  return groups
    .map((group) =>
      matches(group.label)
        ? group
        : {
            ...group,
            permissions: group.permissions.filter((p) => matches(p.label) || matches(p.value)),
          },
    )
    .filter((group) => group.permissions.length > 0);
}

export function splitPermissions(permissions: readonly string[]): {
  pages: Set<string>;
  single: Set<string>;
} {
  const held = new Set<string>(permissions.filter(isPagePermission));
  const pages = new Set(
    permissionGroups()
      .filter((group) => group.permissions.every((p) => held.has(p.value)))
      .map((group) => group.page),
  );
  const single = new Set([...held].filter((p) => !pages.has(p.slice(0, p.lastIndexOf(".")))));
  return { pages, single };
}

export interface PermissionHolder {
  readonly uid: string;
  readonly name: string;
  readonly scope: string;
}

export interface PermissionView {
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  readonly count: number;
  /** `null` when the viewer may only see counts. */
  readonly holders: readonly PermissionHolder[] | null;
}

const scopeLabel = (scope: RoleAssignment["scope"]) =>
  scope.type === "global"
    ? "Everywhere"
    : scope.type === "chapter"
      ? `Chapter ${scope.chapterId}`
      : `Unit ${scope.orgUnitId}`;

/**
 * Who can do what: for every permission, the roles that hold it and the active accounts that hold
 * one of those roles now (not revoked, global or in the active period), each person counted once.
 */
export function permissionHolders(
  roles: readonly { id: string; name: string; permissions: readonly string[] }[],
  users: readonly {
    uid: string;
    name: string;
    status: "active" | "inactive";
    roleAssignments: readonly RoleAssignment[];
  }[],
  activePeriodId: string | null,
  showNames: boolean,
): Map<string, PermissionView> {
  const current = users
    .filter((user) => user.status === "active")
    .map((user) => ({
      user,
      assignments: user.roleAssignments.filter(
        (a) => !a.revokedAt && (!a.periodId || a.periodId === activePeriodId),
      ),
    }));
  const view = new Map<string, PermissionView>();
  for (const permission of PAGE_PERMISSIONS) {
    const holding = roles.filter((role) => role.permissions.includes(permission));
    const ids = new Set(holding.map((role) => role.id));
    const holders = current
      .map(({ user, assignments }) => ({
        uid: user.uid,
        name: user.name,
        scopes: [
          ...new Set(assignments.filter((a) => ids.has(a.roleId)).map((a) => scopeLabel(a.scope))),
        ],
      }))
      .filter((holder) => holder.scopes.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    view.set(permission, {
      roles: holding.map(({ id, name }) => ({ id, name })),
      count: holders.length,
      holders: showNames
        ? holders.map(({ uid, name, scopes }) => ({
            uid,
            name,
            scope: scopes
              .sort((a, b) => Number(b === "Everywhere") - Number(a === "Everywhere"))
              .join(", "),
          }))
        : null,
    });
  }
  return view;
}

export function joinPermissions(pages: ReadonlySet<string>, single: ReadonlySet<string>): string[] {
  return [
    ...permissionGroups()
      .filter((group) => pages.has(group.page))
      .flatMap((group) => group.permissions.map((p) => p.value)),
    ...single,
  ];
}
