import { notFound } from "next/navigation";
import { can, canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toApplicationItem } from "@/components/applications-model";
import { ApplicationsPage } from "@/components/applications-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads, analysisActions, interviewReads } from "@/server/wiring";

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
  const [users, personality, proofs] = await Promise.all([
    adminReads.getUsers(uids),
    adminReads.personalityResults(uids),
    adminReads.studentProofs(uids),
  ]);
  const ai = committee
    ? await analysisActions().read(
        viewer.principal,
        applications.map((a) => a.id),
        uids,
      )
    : undefined;
  const unitTypes = new Map(
    (await adminReads.listOrgUnits(recruitment.periodId)).map((u) => [u.id, u.type]),
  );
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
        ),
      )}
      canReview={can(viewer.principal, "recruitment.review")}
      canOffer={can(viewer.principal, "recruitment.offer")}
      canConfirm={can(viewer.principal, "recruitment.confirm")}
      ai={can(viewer.principal, "recruitment.ai") ? ai : undefined}
    />
  );
}
