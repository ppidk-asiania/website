import { notFound } from "next/navigation";
import { inTreeOrder, orgUnitPath } from "@website/domain/organizations";
import { formatMoney, isClosed, isUnderway, type RevisionChanges } from "@website/domain/programs";
import { can, canAccessAdmin } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { ProgramPage } from "@/components/program-page";
import { canManageProgram, canOpenProgram } from "@/server/programs";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function ProgramRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/programs/${id}`);
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  if (!safeId.safeParse(id).success || !canAccessAdmin(principal)) notFound();
  const program = await adminReads.getProgram(id);
  if (!program || program.deletedAt) notFound();
  const scope = { orgUnitPath: program.orgUnitPath };
  // A PIC opens their own programme without `programs.read`.
  if (!canOpenProgram(principal, program)) notFound();
  const revisions = await adminReads.listProgramRevisions(program.id);
  const [units, objectives, checkins, people] = await Promise.all([
    adminReads.listOrgUnits(program.periodId),
    adminReads.listObjectives(program.periodId),
    adminReads.listCheckins(program.id),
    adminReads.getUsers([...program.pics, ...revisions.map((r) => r.requestedBy)]),
  ]);
  const keyResultOptions = objectives.flatMap((o) =>
    o.keyResults.map((kr) => ({ value: kr.id, label: `${o.title} → ${kr.title}` })),
  );
  const keyResultName = (krId: string) =>
    keyResultOptions.find((k) => k.value === krId)?.label ?? krId;
  const unitName = (unitId: string) => units.find((u) => u.id === unitId)?.name ?? unitId;
  const personName = (uid: string) => people.get(uid)?.name ?? people.get(uid)?.email ?? uid;
  const describe = (c: RevisionChanges) =>
    [
      c.name !== undefined && `Name: ${c.name}`,
      c.orgUnitId !== undefined && `Unit: ${unitName(c.orgUnitId)}`,
      c.goal !== undefined && `Goal: ${c.goal || "—"}`,
      c.plannedStart !== undefined && `Start: ${c.plannedStart ?? "—"}`,
      c.plannedEnd !== undefined && `End: ${c.plannedEnd ?? "—"}`,
      c.budgets !== undefined && `Budget: ${c.budgets.map(formatMoney).join(" · ") || "—"}`,
      c.keyResultIds !== undefined &&
        `Key results: ${c.keyResultIds.map(keyResultName).join(", ") || "none"}`,
    ].filter((line): line is string => typeof line === "string");
  const open = !isClosed(program.status);
  const manage = canManageProgram(principal, program);
  const canPlan = open && can(principal, "programs.edit", scope);
  return (
    <ProgramPage
      program={{
        id: program.id,
        version: program.version,
        periodId: program.periodId,
        name: program.name,
        goal: program.goal,
        description: program.description,
        status: program.status,
        progress: program.progressPercent,
        unitName: units.find((u) => u.id === program.orgUnitId)?.name ?? "",
        keyResults: program.keyResultIds.map(keyResultName),
        planned: [program.plannedStart, program.plannedEnd].filter(Boolean).join(" – "),
        budgets: program.budgets.map(formatMoney),
        pics: program.pics.map((uid) => people.get(uid)?.name ?? people.get(uid)?.email ?? uid),
        health: program.health && {
          status: program.health.status,
          reason: program.health.reason,
          at: formatUtc(program.health.at),
        },
        reviewNote: program.reviewNote,
        cancelReason: program.cancelReason,
        milestones: program.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          dueOn: m.dueOn,
          weight: m.weight,
          sort: m.sort,
          done: m.completedAt !== null,
        })),
      }}
      plan={{
        id: program.id,
        version: program.version,
        name: program.name,
        goal: program.goal,
        description: program.description,
        orgUnitId: program.orgUnitId,
        keyResultIds: [...program.keyResultIds],
        plannedStart: program.plannedStart,
        plannedEnd: program.plannedEnd,
        budgets: [...program.budgets],
        picEmails: program.pics.map((uid) => people.get(uid)?.email ?? "").filter(Boolean),
      }}
      options={
        canPlan || (manage && open)
          ? {
              // A PIC who cannot edit the unit still sees it, to ask for a revision.
              units: inTreeOrder(units)
                .filter(
                  (u) =>
                    !u.deletedAt &&
                    (u.id === program.orgUnitId ||
                      can(principal, "programs.edit", { orgUnitPath: orgUnitPath(u) })),
                )
                .map((u) => ({ id: u.id, name: u.name })),
              keyResults: keyResultOptions,
            }
          : null
      }
      revisions={revisions.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        requestedBy: personName(r.requestedBy),
        changes: describe(r.changes),
        decidable: r.status === "pending" && r.requestedBy !== principal.userId,
      }))}
      checkins={checkins.map((c) => ({
        id: c.id,
        weekStart: c.weekStart,
        achievements: c.achievements,
        blockers: c.blockers,
        nextPlan: c.nextPlan,
      }))}
      can={{
        approve: can(principal, "programs.approve", scope),
        manage: manage && open,
        checkIn: manage && isUnderway(program.status),
        plan: canPlan,
        revise:
          manage && isUnderway(program.status) && !revisions.some((r) => r.status === "pending"),
        author:
          program.createdBy === principal.userId &&
          (program.status === "draft" || program.status === "proposed"),
      }}
    />
  );
}
