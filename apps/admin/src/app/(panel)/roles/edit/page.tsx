import { can, DEFAULT_ROLE_COLOR, isSystemRoleId, scopedChapterIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { RoleManagerRoles } from "@/components/role-manager-page";
import { permissionGroups, permissionHolders } from "@/components/role-manager-model";
import { RolePermissions } from "@/components/role-permissions-page";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function RoleManagerEditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/roles/edit", "roles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const canEdit = can(viewer.principal, "roles.edit");
  const roles = await adminReads.listRoles();
  if ((await searchParams)["view"] === "permissions") {
    // Names are personal data of users.read: a viewer limited to some chapters sees counts only.
    const showNames =
      can(viewer.principal, "users.read") &&
      scopedChapterIds(viewer.principal, "users.read") === "all";
    const [holders, period] = await Promise.all([
      adminReads.listRoleHolders(roles.filter((r) => r.permissions.length > 0).map((r) => r.id)),
      adminReads.activePeriod(),
    ]);
    const view = permissionHolders(
      roles,
      holders.map((u) => ({
        uid: u.uid,
        name: u.name ?? u.email ?? u.uid,
        status: u.status,
        roleAssignments: u.roleAssignments,
      })),
      period?.id ?? null,
      showNames,
    );
    return (
      <RolePermissions
        groups={permissionGroups().map((group) => ({
          page: group.page,
          label: group.label,
          permissions: group.permissions.map((p) => ({
            value: p.value,
            label: p.label,
            ...(view.get(p.value) ?? { roles: [], count: 0, holders: null }),
          })),
        }))}
      />
    );
  }
  const [holders, roleMap] = await Promise.all([
    adminReads.countHolders(roles.map((r) => r.id)),
    canEdit ? adminReads.getAppointmentRoleMap() : null,
  ]);

  return (
    <RoleManagerRoles
      roles={roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color ?? DEFAULT_ROLE_COLOR,
        permissions: [...role.permissions],
        version: "version" in role && typeof role.version === "number" ? role.version : null,
        holders: holders.get(role.id) ?? 0,
        builtIn: isSystemRoleId(role.id),
      }))}
      canEdit={canEdit}
      canSeePeople={can(viewer.principal, "users.read")}
      reauthUrl={signInAgainUrl("/roles/edit")}
      roleMap={roleMap}
    />
  );
}
