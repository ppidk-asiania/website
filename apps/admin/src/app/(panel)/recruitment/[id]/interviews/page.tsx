import { notFound } from "next/navigation";
import { rubricOf } from "@website/domain/recruitment";
import { can } from "@website/permissions";
import { RubricEditor } from "@/components/rubric-editor";
import { AccessMessage } from "@/components/access-message";
import { InterviewsPage } from "@/components/interviews-page";
import { toSlotItems } from "@/components/interviews-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function InterviewsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/recruitment/${id}/interviews`, "recruitment.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const committee = ["recruitment.review", "recruitment.offer", "recruitment.confirm"] as const;
  if (!committee.some((p) => can(viewer.principal, p))) return <AccessMessage reason="no-access" />;
  const recruitment = await adminReads.getRecruitment(id);
  if (!recruitment || recruitment.deletedAt) notFound();
  const [slots, applications] = await Promise.all([
    adminReads.listInterviewSlots(recruitment.id),
    adminReads.listApplications(recruitment.id),
  ]);
  const people = await adminReads.getUsers([
    ...applications.map((a) => a.userId),
    ...slots.flatMap((s) => (s.interviewerUid ? [s.interviewerUid] : [])),
  ]);
  const units = await adminReads.listOrgUnits(recruitment.periodId);
  const names = new Map<string, string>([
    ...units.map((u) => [u.id, u.name] as const),
    ...[...people].map(([uid, p]) => [uid, p.name ?? p.email ?? uid] as const),
  ]);
  const review = can(viewer.principal, "recruitment.review");
  return (
    <>
      <InterviewsPage
        recruitment={{ id: recruitment.id, title: recruitment.title }}
        slots={toSlotItems(slots, applications, names, () => review)}
        canEdit={review}
      />
      {can(viewer.principal, "recruitment.edit") ? (
        <RubricEditor
          key={recruitment.version}
          recruitmentId={recruitment.id}
          version={recruitment.version}
          aspects={rubricOf(recruitment)}
        />
      ) : null}
    </>
  );
}
