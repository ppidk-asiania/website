import { answerText, type FileAnswer, type Question } from "@website/domain/forms";
import type { MemberProfile, ProofMark } from "@website/domain/members";
import { seatLabel, type AppointmentSeat, type OrgUnitType } from "@website/domain/organizations";
import {
  offerExpired,
  waitingFor,
  AXES,
  type Application,
  type PersonalityScore,
  type ApplicationStatus,
  type Recruitment,
  type RevisionRound,
} from "@website/domain/recruitment";
import { APPLICATION_STATUS_LABELS, label } from "../labels";

export const QUEUE_TABS = [
  { key: "all", label: "All" },
  { key: "review", label: "To review" },
  { key: "revision", label: "Revision" },
  { key: "interview", label: "Interview" },
  { key: "offered", label: "Offered" },
  { key: "accepted", label: "Accepted" },
  { key: "placement", label: "Placement" },
  { key: "closed", label: "Closed" },
] as const;
export type QueueTab = (typeof QUEUE_TABS)[number]["key"];

const TAB_STATUSES: Record<Exclude<QueueTab, "all">, readonly ApplicationStatus[]> = {
  review: ["submitted"],
  revision: ["revision"],
  interview: ["interview"],
  offered: ["offered"],
  accepted: ["accepted"],
  placement: ["approved", "pakta_review", "confirmed"],
  closed: ["admin_rejected", "declined", "rejected", "withdrawn"],
};

export function matchesQueueTab(item: Pick<ApplicationItem, "status">, tab: QueueTab): boolean {
  return tab === "all" || TAB_STATUSES[tab].includes(item.status);
}

export const PROOF_MARKS = {
  ok: { label: "Proof OK", tone: "success" },
  fix: { label: "Fix asked", tone: "danger" },
  fixed: { label: "Fixed", tone: "primary" },
  none: { label: "Not checked", tone: "neutral" },
} as const satisfies Record<ProofMark, { label: string; tone: string }>;

export interface ApplicationItem {
  id: string;
  version: number;
  userId: string;
  name: string;
  email: string;
  status: ApplicationStatus;
  statusLabel: string;
  choices: { id: string; name: string; seat: string | null; wish: AppointmentSeat | null }[];
  submittedAt: string | null;
  revisionRound: number;
  offer: {
    orgUnitId: string;
    unitName: string;
    seat: AppointmentSeat;
    seatLabel: string;
    expiresAt: string;
    expired: boolean;
  } | null;
  answers: { id: string; label: string; text: string; file: FileAnswer | null }[];
  portfolio: FileAnswer | null;
  pacts: FileAnswer[];
  pactNote: string | null;
  appointmentId: string | null;
  waitingFor: string[];
  proof: { mark: ProofMark; note: string; at: string | null; main: boolean; supporting: boolean };
  personality: { full: string; axes: string } | null;
  revisions: {
    round: number;
    request: string;
    requestedAt: string;
    resubmittedAt: string | null;
  }[];
}

const isFile = (value: unknown): value is FileAnswer =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "path" in value;

export function toApplicationItem(
  a: Application,
  r: Pick<Recruitment, "units">,
  questions: readonly Question[],
  user: { name: string | null; email: string | null } | null,
  revisions: readonly RevisionRound[],
  now: Date,
  personality: Pick<PersonalityScore, "full" | "axes"> | null = null,
  proof: Pick<MemberProfile, "studentProof" | "proofReview"> | null = null,
  unitTypes: ReadonlyMap<string, OrgUnitType> = new Map(),
): ApplicationItem {
  const unitName = (id: string) => r.units.find((u) => u.orgUnitId === id)?.name ?? id;
  const seatOf = (id: string, seat: AppointmentSeat) =>
    seatLabel(seat, { name: unitName(id), type: unitTypes.get(id) ?? "staf" });
  return {
    id: a.id,
    version: a.version,
    userId: a.userId,
    name: user?.name ?? user?.email ?? a.userId,
    email: user?.email ?? "",
    status: a.status,
    statusLabel: label(APPLICATION_STATUS_LABELS, a.status),
    choices: a.choices.map((id) => {
      const seat = a.choiceSeats[id];
      return { id, name: unitName(id), seat: seat ? seatOf(id, seat) : null, wish: seat ?? null };
    }),
    submittedAt: a.submittedAt?.toISOString() ?? null,
    revisionRound: a.revisionRound,
    offer: a.offer && {
      orgUnitId: a.offer.orgUnitId,
      unitName: unitName(a.offer.orgUnitId),
      seat: a.offer.seat,
      seatLabel: seatOf(a.offer.orgUnitId, a.offer.seat),
      expiresAt: a.offer.expiresAt.toISOString(),
      expired: offerExpired(a.offer, now),
    },
    answers: questions.map((q) => {
      const value = a.answers[q.id];
      return {
        id: q.id,
        label: q.label,
        text: answerText(value),
        file: isFile(value) ? value : null,
      };
    }),
    portfolio: a.portfolio,
    pacts: [...a.pacts],
    pactNote: a.pactNote,
    appointmentId: a.appointmentId,
    waitingFor: waitingFor(questions, a.answers).map((q) => q.label),
    proof: {
      mark: proof?.proofReview?.state ?? "none",
      note: proof?.proofReview?.note ?? "",
      at: proof?.proofReview?.at.toISOString() ?? null,
      main: Boolean(proof?.studentProof),
      supporting: Boolean(proof?.studentProof?.supporting),
    },
    personality: personality && {
      full: personality.full,
      axes: AXES.map(
        (axis) => `${personality.axes[axis].pct}% ${personality.axes[axis].letter}`,
      ).join(" · "),
    },
    revisions: revisions
      .filter((rev) => rev.applicationId === a.id)
      .map((rev) => ({
        round: rev.round,
        request: rev.request,
        requestedAt: rev.requestedAt.toISOString(),
        resubmittedAt: rev.resubmittedAt?.toISOString() ?? null,
      })),
  };
}
