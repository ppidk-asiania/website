import { notFound } from "next/navigation";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import {
  OpportunityApplicantsPage,
  type ApplicantRow,
} from "@/components/opportunity-applicants-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function OpportunityApplicantsRoute({
  params,
}: PageProps<"/opportunities/[id]/applicants">) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/opportunities/${id}/applicants`, "opportunities.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const posting = await adminReads.getOpportunity(id);
  const scope = posting?.chapterId ? { chapterId: posting.chapterId } : {};
  // A posting the viewer may not read looks the same as one that does not exist.
  if (!posting || posting.deletedAt || !can(viewer.principal, "opportunities.read", scope)) {
    notFound();
  }
  const applications = await adminReads.listApplicants(id);
  const people = await adminReads.getUsers(applications.map((a) => a.userId));
  const rows: ApplicantRow[] = applications.map((a) => {
    const person = people.get(a.userId);
    return {
      id: a.id,
      name: person?.name ?? person?.email ?? "(unknown account)",
      email: person?.email ?? "",
      coverLetter: a.coverLetter,
      status: a.status,
      note: a.note ?? "",
      appliedAt: a.createdAt.toISOString().slice(0, 10),
    };
  });
  return (
    <OpportunityApplicantsPage
      title={posting.title}
      rows={rows}
      canEdit={can(viewer.principal, "opportunities.edit", scope)}
    />
  );
}
