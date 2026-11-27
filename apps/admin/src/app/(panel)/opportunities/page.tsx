import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { OpportunitiesPage, type OpportunityRow } from "@/components/opportunities-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function AdminOpportunitiesPage() {
  const viewer = await requireAdminViewer("/opportunities", "opportunities.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const globalEditor = can(principal, "opportunities.edit");
  const [all, chapters, forms, mentorshipFormId] = await Promise.all([
    adminReads.listOpportunities(),
    adminReads.listChapters(),
    globalEditor ? adminReads.listRegistrationForms() : Promise.resolve([]),
    globalEditor ? adminReads.mentorshipFormId() : Promise.resolve(null),
  ]);
  const chapterName = new Map(chapters.map((c) => [c.id, c.name]));
  const scope = (chapterId: string | null) => (chapterId ? { chapterId } : {});
  const rows: OpportunityRow[] = all
    .filter((o) => can(principal, "opportunities.read", scope(o.chapterId)))
    .map((o) => ({
      id: o.id,
      version: o.version,
      title: o.title,
      organization: o.organization,
      country: o.country,
      city: o.city,
      type: o.type,
      description: o.description,
      requirements: o.requirements,
      deadline: o.deadline,
      applyUrl: o.applyUrl ?? "",
      image: o.image,
      status: o.status,
      chapterId: o.chapterId,
      owner: o.chapterId ? `Chapter ${chapterName.get(o.chapterId) ?? "(removed)"}` : "Region",
      clicks: o.clicks,
      applicants: o.applicants,
      canEdit: can(principal, "opportunities.edit", scope(o.chapterId)),
    }));
  // Where a new posting may go: the region and each chapter the viewer may edit.
  const owners = [
    ...(globalEditor ? [{ value: "", label: "Region" }] : []),
    ...chapters
      .filter((c) => can(principal, "opportunities.edit", { chapterId: c.id }))
      .map((c) => ({ value: c.id, label: `Chapter ${c.name}` })),
  ];
  const mentorship = globalEditor
    ? { formId: mentorshipFormId ?? "", forms: forms.map((f) => ({ id: f.id, title: f.title })) }
    : null;
  return <OpportunitiesPage rows={rows} owners={owners} mentorship={mentorship} />;
}
