import { notFound } from "next/navigation";
import { hasInterviewScope } from "@website/domain/recruitment";
import { scopedOrgUnitIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { RecapPage } from "@/components/recap-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads, interviewScopeOf, loadRecap } from "@/server/wiring";

export const instant = false;

export default async function RecapRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { id } = await params;
  const { scope: switchTo } = await searchParams;
  const viewer = await requireAdminViewer(`/recruitment/${id}/recap`);
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  // Global recruitment.read sees everything; seat holders and interviewers see their unit tree.
  const scope =
    scopedOrgUnitIds(viewer.principal, "recruitment.read") === "all"
      ? { all: true, orgUnitIds: new Set<string>() }
      : await interviewScopeOf(viewer.principal.userId);
  if (!hasInterviewScope(scope)) return <AccessMessage reason="no-access" />;
  const recruitment = await adminReads.getRecruitment(id);
  if (!recruitment || recruitment.deletedAt) notFound();
  const wholePeriod = switchTo === "period";
  const ids = wholePeriod
    ? (await adminReads.listRecruitments())
        .filter((r) => r.periodId === recruitment.periodId && r.deletedAt === null)
        .map((r) => r.id)
    : [recruitment.id];
  return (
    <RecapPage
      recruitment={{ id: recruitment.id, title: recruitment.title }}
      wholePeriod={wholePeriod}
      recap={await loadRecap(ids, scope)}
    />
  );
}
