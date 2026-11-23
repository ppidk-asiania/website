import { notFound } from "next/navigation";
import { can, isSystemRoleId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { OrgOfficersPage } from "@/components/org-officers-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function UnitOfficersRoute({
  params,
}: {
  params: Promise<{ id: string; unitId: string }>;
}) {
  const { id, unitId } = await params;
  const viewer = await requireAdminViewer(
    `/organizations/periods/${id}/units/${unitId}/officers`,
    "appointments.read",
  );
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const [unit, period] = await Promise.all([
    adminReads.getOrgUnit(unitId),
    adminReads.getPeriod(id),
  ]);
  if (!unit || unit.deletedAt || unit.periodId !== id || !period) notFound();
  const canRoleMap = can(viewer.principal, "roles.edit");
  const [appointments, roles] = await Promise.all([
    adminReads.listAppointments(id),
    canRoleMap ? adminReads.listRoles() : null,
  ]);
  return (
    <OrgOfficersPage
      periodId={id}
      unit={{
        id: unit.id,
        name: unit.name,
        type: unit.type,
        version: unit.version,
        roleMap: unit.roleMap ?? {},
      }}
      people={appointments
        .filter((a) => a.orgUnitId === unit.id && a.status === "active")
        .map((a) => ({
          id: a.id,
          version: a.version,
          orgUnitId: a.orgUnitId,
          name: a.name,
          title: a.title,
          seat: a.seat,
          status: a.status,
          startsOn: a.startsOn,
        }))}
      roles={
        roles?.filter((r) => !isSystemRoleId(r.id)).map((r) => ({ id: r.id, name: r.name })) ?? null
      }
      canEdit={can(viewer.principal, "appointments.edit")}
      archived={period.status === "archived"}
    />
  );
}
