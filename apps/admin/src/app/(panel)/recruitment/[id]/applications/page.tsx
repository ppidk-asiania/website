import { notFound } from "next/navigation";
import { can, canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { hasInterviewScope, passedReview, rubricOf } from "@website/domain/recruitment";
import { toApplicationItem, toAssessmentPanel } from "@/components/applications-model";
import { ApplicationsPage } from "@/components/applications-page";
import { requireAdminViewer } from "@/server/context";
import {
  adminReads,
  analysisActions,
  applicantOrigins,
  interviewReads,
  interviewScopeOf,
} from "@/server/wiring";

export const instant = false;

export default async function ApplicationsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/recruitment/${id}/applications`);
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const committeePermissions = [
    "recruitment.review",
    "recruitment.offer",
    "recruitment.confirm",
    "recruitment.ai",
  ] as const;
  const committee =
    canInSomeScope(viewer.principal, "recruitment.read") &&
    committeePermissions.some((p) => can(viewer.principal, p));
  const recruitment = await adminReads.getRecruitment(id);
  if (!recruitment || recruitment.deletedAt) notFound();
  // Without a committee permission an interviewer opens, read-only, the applicants in their scope.
  const own = committee ? null : await interviewReads().applicants(viewer.principal.userId, id);
  if (own !== null && own.length === 0) return <AccessMessage reason="no-access" />;
  const [applications, revisions, version] = await Promise.all([
    own ?? adminReads.listApplications(recruitment.id),
    adminReads.listRevisions(recruitment.id),
    adminReads.getFormVersion(recruitment.formId, recruitment.formVersion),
  ]);
  const uids = [...new Set(applications.map((a) => a.userId))];
  const [users, personality, proofs, origins] = await Promise.all([
    adminReads.getUsers(uids),
    adminReads.personalityResults(uids),
    adminReads.studentProofs(uids),
    applicantOrigins(uids),
  ]);
  const ai = committee
    ? await analysisActions().read(
        viewer.principal,
        applications.map((a) => a.id),
        uids,
      )
    : undefined;
  const units = await adminReads.listOrgUnits(recruitment.periodId);
  const unitTypes = new Map(units.map((u) => [u.id, u.type]));
  const review = can(viewer.principal, "recruitment.review");
  const uid = viewer.principal.userId;
  const [assessments, scope] = await Promise.all([
    interviewReads().assessments(uid, recruitment.id, review),
    interviewScopeOf(uid),
  ]);
  const raters = await adminReads.getUsers([...new Set(assessments.map((a) => a.uid))]);
  const names = new Map<string, string>([
    ...units.map((u) => [u.id, u.name] as const),
    ...[...raters].map(([id, p]) => [id, p.name ?? p.email ?? id] as const),
  ]);
  const now = new Date();
  return (
    <ApplicationsPage
      recruitment={{
        id: recruitment.id,
        title: recruitment.title,
        personalityTest: recruitment.personalityTest,
        units: recruitment.units.map((u) => ({ id: u.orgUnitId, name: u.name, seats: u.seats })),
      }}
      initial={applications.map((a) =>
        toApplicationItem(
          a,
          recruitment,
          version?.questions ?? [],
          users.get(a.userId) ?? null,
          revisions,
          now,
          personality.get(a.userId) ?? null,
          proofs.get(a.userId) ?? null,
          unitTypes,
          toAssessmentPanel({
            booked: a.choices.filter((c) => a.interviews[c]),
            assessments: assessments.filter((x) => x.applicationId === a.id),
            rubric: rubricOf(recruitment),
            names,
            viewerUid: uid,
            canAssess: hasInterviewScope(scope) && passedReview(a.status),
          }),
          origins.get(a.userId) ?? null,
        ),
      )}
      canReview={review}
      canOffer={can(viewer.principal, "recruitment.offer")}
      canConfirm={can(viewer.principal, "recruitment.confirm")}
      ai={can(viewer.principal, "recruitment.ai") ? ai : undefined}
    />
  );
}
