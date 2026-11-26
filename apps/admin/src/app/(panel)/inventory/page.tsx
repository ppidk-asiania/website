import { orgUnitPath } from "@website/domain/organizations";
import { scopeOfItem } from "@website/domain/inventory";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { InventoryPage, type ItemRow } from "@/components/inventory-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function InventoryRoute() {
  const viewer = await requireAdminViewer("/inventory", "inventory.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;

  const periods = await adminReads.listPeriods();
  const active = periods.find((p) => p.status === "active");
  const [items, chapters, units, log] = await Promise.all([
    adminReads.listInventory(),
    adminReads.listChapters(),
    active ? adminReads.listOrgUnits(active.id) : Promise.resolve([]),
    adminReads.inventoryLog(100),
  ]);
  const chapterName = new Map(chapters.map((c) => [c.id, c.name]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const ownerLabel = (o: (typeof items)[number]["owner"]) =>
    o.kind === "region"
      ? "Region"
      : o.kind === "chapter"
        ? `Chapter ${chapterName.get(o.chapterId) ?? "(removed)"}`
        : `Unit ${unitName.get(o.orgUnitId) ?? "(removed)"}`;

  // The owner's scope decides who sees and manages an item (the usual scopes).
  const mine = items.filter((i) => can(principal, "inventory.read", scopeOfItem(i.owner)));
  const rows: ItemRow[] = mine.map((i) => ({
    id: i.id,
    version: i.version,
    owner: ownerLabel(i.owner),
    name: i.name,
    category: i.category,
    description: i.description,
    image: i.image,
    total: i.total,
    available: i.available,
    condition: i.condition,
    location: i.location,
    custodianName: i.custodianName ?? "",
    published: i.published,
    lentBy: i.lentBy?.name ?? null,
    canEdit: can(principal, "inventory.edit", scopeOfItem(i.owner)),
  }));
  const names = new Map(mine.map((i) => [i.id, i.name]));
  const people = await adminReads.getUsers([
    ...new Set(log.flatMap((l) => (l.by && names.has(l.itemId) ? [l.by] : []))),
  ]);

  return (
    <InventoryPage
      rows={rows}
      owners={[
        ...(can(principal, "inventory.edit") ? [{ value: "region", label: "Region" }] : []),
        ...chapters
          .filter((c) => can(principal, "inventory.edit", { chapterId: c.id }))
          .map((c) => ({ value: `chapter:${c.id}`, label: `Chapter ${c.name}` })),
        ...units
          .filter((u) => can(principal, "inventory.edit", { orgUnitPath: orgUnitPath(u) }))
          .map((u) => ({ value: `unit:${u.id}`, label: `Unit ${u.name}` })),
      ]}
      log={log
        .filter((l) => names.has(l.itemId))
        .map((l) => ({
          id: l.id,
          item: names.get(l.itemId) ?? "",
          action: l.action,
          change: l.change,
          note: l.note,
          by: l.by ? (people.get(l.by)?.name ?? people.get(l.by)?.email ?? l.by) : "",
          at: l.at.toISOString().slice(0, 16).replace("T", " "),
        }))}
    />
  );
}
