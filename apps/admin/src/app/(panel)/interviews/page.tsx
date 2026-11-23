import Link from "next/link";
import { hasInterviewScope } from "@website/domain/recruitment";
import { AccessMessage } from "@/components/access-message";
import { InterviewsPage } from "@/components/interviews-page";
import { toSlotItems } from "@/components/interviews-model";
import { Card, CardBody } from "@/components/ui/card";
import { requireAdminViewer } from "@/server/context";
import { adminReads, interviewReads, interviewScopeOf } from "@/server/wiring";

export const instant = false;

const stamp = (at: Date) => `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default async function MyInterviewsRoute({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; tab?: string; scope?: string }>;
}) {
  const query = await searchParams;
  const viewer = await requireAdminViewer("/interviews");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const uid = viewer.principal.userId;
  const scope = await interviewScopeOf(uid);
  if (!hasInterviewScope(scope)) return <AccessMessage reason="no-access" />;

  const open = (await adminReads.listRecruitments())
    .filter((r) => r.published && !r.deletedAt)
    .sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime());
  const recruitment = open.find((r) => r.id === query.r) ?? open[0];
  if (!recruitment) return <AccessMessage reason="no-access" />;

  const [slots, applicants, units] = await Promise.all([
    adminReads.listInterviewSlots(recruitment.id),
    interviewReads().applicants(uid, recruitment.id),
    adminReads.listOrgUnits(recruitment.periodId),
  ]);
  const mySlots = slots.filter((s) => s.interviewerUid === uid);
  const people = await adminReads.getUsers([
    ...applicants.map((a) => a.userId),
    ...slots.flatMap((s) => (s.interviewerUid ? [s.interviewerUid] : [])),
  ]);
  const names = new Map<string, string>([
    ...units.map((u) => [u.id, u.name] as const),
    ...[...people].map(([id, p]) => [id, p.name ?? p.email ?? id] as const),
  ]);
  const base = `/interviews?r=${recruitment.id}`;
  const tab = query.tab === "interviews" ? "interviews" : "times";
  const everyone = query.scope === "all";
  const mine = new Set(mySlots.map((s) => s.id));
  const listed = everyone
    ? applicants
    : applicants.filter((a) => Object.values(a.interviews).some((b) => mine.has(b.slotId)));
  const slotById = new Map(slots.map((s) => [s.id, s]));

  return (
    <div>
      <nav aria-label="Interview views" className="admin-toolbar">
        <Link href={`${base}&tab=times`} aria-current={tab === "times" ? "page" : undefined}>
          My times
        </Link>{" "}
        ·{" "}
        <Link
          href={`${base}&tab=interviews`}
          aria-current={tab === "interviews" ? "page" : undefined}
        >
          Interviews
        </Link>
        {open.length > 1
          ? open.map((r) => (
              <span key={r.id}>
                {" "}
                · <Link href={`/interviews?r=${r.id}&tab=${tab}`}>{r.title}</Link>
              </span>
            ))
          : null}
      </nav>
      {tab === "times" ? (
        <InterviewsPage
          recruitment={{ id: recruitment.id, title: recruitment.title }}
          slots={toSlotItems(mySlots, applicants, names, () => true)}
          canEdit
          mine={{
            units: units
              .filter((u) => !u.deletedAt && (scope.all || scope.slotUnitIds.has(u.id)))
              .map((u) => ({ id: u.id, name: u.name })),
          }}
        />
      ) : (
        <div>
          <div className="admin-page-header">
            <div>
              <h1 className="admin-page-header__title">Interviews</h1>
              <p className="admin-page-header__desc">
                {recruitment.title} ·{" "}
                {everyone ? "everyone in your scope" : "applicants on your times"} ·{" "}
                <Link href={`${base}&tab=interviews${everyone ? "" : "&scope=all"}`}>
                  {everyone ? "Only my times" : "Everyone in my scope"}
                </Link>
              </p>
            </div>
          </div>
          <Card className="admin-list-card">
            <CardBody>
              {listed.length === 0 ? (
                <span className="admin-card__subtitle">No applicants to show.</span>
              ) : (
                <ol className="admin-detail-rounds">
                  {listed.map((a) => (
                    <li key={a.id}>
                      <strong>{names.get(a.userId) ?? a.userId}</strong>
                      {a.choices.map((c) => {
                        const booking = a.interviews[c];
                        const slot = booking ? slotById.get(booking.slotId) : undefined;
                        return (
                          <div key={c}>
                            {names.get(c) ?? c}:{" "}
                            {booking
                              ? `${stamp(booking.startsAt)}${
                                  slot?.interviewerUid
                                    ? ` · ${names.get(slot.interviewerUid) ?? slot.interviewerUid}`
                                    : ""
                                }${booking.attendance ? ` · ${booking.attendance}` : ""}`
                              : "not booked"}
                          </div>
                        );
                      })}
                      <Link href={`/recruitment/${recruitment.id}/applications`}>Open</Link>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
