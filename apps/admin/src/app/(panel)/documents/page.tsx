import { unitDocumentRights } from "@website/domain/organizations";
import { AccessMessage } from "@/components/access-message";
import { UnitDocumentsPage, type UnitDocumentRow } from "@/components/unit-documents-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads, unitDocumentActions } from "@/server/wiring";

export const instant = false;

export default async function DocumentsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Any seat reaches the page; the permission is only the second way in (the extra).
  const viewer = await requireAdminViewer("/documents");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const rights = await unitDocumentActions().viewerOf(viewer.principal);
  if (!rights.editor && rights.seatUnitIds.length === 0)
    return <AccessMessage reason="no-access" />;

  const params = await searchParams;
  const periods = rights.editor ? await adminReads.listPeriods() : [];
  const asked = typeof params["period"] === "string" ? params["period"] : "";
  // A caller cannot name the period: only editors may look at another one.
  const periodId = periods.some((p) => p.id === asked) ? asked : rights.activePeriodId;
  if (periodId === null) return <p>Activate a board period first.</p>;

  const [docs, units] = await Promise.all([
    adminReads.listUnitDocuments(periodId),
    adminReads.listOrgUnits(periodId),
  ]);
  const people = await adminReads.getUsers([...new Set(docs.map((d) => d.uploadedBy))]);
  const unitName = new Map(units.filter((u) => !u.deletedAt).map((u) => [u.id, u.name]));
  const rows: UnitDocumentRow[] = docs.map((d) => ({
    id: d.id,
    version: d.version,
    orgUnitId: d.orgUnitId,
    unit: d.orgUnitId ? (unitName.get(d.orgUnitId) ?? "Removed unit") : "Whole period",
    folder: d.folder,
    title: d.title,
    fileName: d.file.name,
    size: d.file.size,
    uploadedBy: people.get(d.uploadedBy)?.name ?? people.get(d.uploadedBy)?.email ?? d.uploadedBy,
    uploadedAt: d.createdAt.toISOString().slice(0, 10),
    canWrite: unitDocumentRights(rights, d).write,
  }));
  // Where this person may add files: the own units, and every folder for the extra.
  const folders = [
    ...(rights.editor ? [{ id: null, name: "Whole period" }] : []),
    ...units
      .filter((u) => !u.deletedAt && (rights.editor || rights.seatUnitIds.includes(u.id)))
      .map((u) => ({ id: u.id, name: u.name })),
  ];
  return (
    <UnitDocumentsPage
      rows={rows}
      folders={periodId === rights.activePeriodId ? folders : []}
      periods={periods.map((p) => ({ id: p.id, name: p.name }))}
      periodId={periodId}
    />
  );
}
