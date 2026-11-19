import { answerText, type FileAnswer, type Question } from "@website/domain/forms";
import type { MemberProfile, ProofMark } from "@website/domain/members";
import { seatLabel, type AppointmentSeat, type OrgUnitType } from "@website/domain/organizations";
import {
  assessmentAverage,
  assessmentSummary,
  NO_RELATION,
  offerExpired,
  QUEUE_STAGES,
  RECOMMENDATIONS,
  waitingFor,
  AXES,
  type Application,
  type Assessment,
  type Recommendation,
  type RubricAspect,
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

export function matchesQueueTab(item: Pick<ApplicationItem, "status">, tab: QueueTab): boolean {
  return tab === "all" || (QUEUE_STAGES[tab] as readonly ApplicationStatus[]).includes(item.status);
}

/** The full sentence behind the short status label (tooltip in the applicants table). */
export const STATUS_HINTS: Record<ApplicationStatus, string> = {
  draft: "The applicant is still writing the application.",
  submitted: "Sent; waiting for the document check.",
  revision: "The committee asked the applicant to revise the application.",
  admin_rejected: "Did not pass the document check.",
  interview: "Passed the document check; interviews are open.",
  offered: "A unit and seat were offered; waiting for the answer.",
  accepted: "The applicant accepted the offer; waiting for placement approval.",
  declined: "The applicant declined the offer.",
  approved: "Placement approved; waiting for the signed pact.",
  pakta_review: "The signed pact is being reviewed.",
  confirmed: "Confirmed and appointed to the seat.",
  rejected: "Not selected.",
  withdrawn: "The applicant withdrew the application.",
};

/** "1. Media - 2. Finance": the choices in one line under the table column. */
export const choicesLine = (item: Pick<ApplicationItem, "choices">) =>
  item.choices.map((c, i) => `${i + 1}. ${c.seat ?? c.name}`).join(" - ");

export const PROOF_MARKS = {
  ok: { label: "Proof OK", tone: "success" },
  fix: { label: "Fix asked", tone: "danger" },
  fixed: { label: "Fixed", tone: "primary" },
  none: { label: "Not checked", tone: "neutral" },
} as const satisfies Record<ProofMark, { label: string; tone: string }>;

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strongly_recommended: "Strongly recommended",
  recommended: "Recommended",
  unsure: "Unsure",
  not_recommended: "Not recommended",
};

export interface AssessmentForm {
  choiceId: string;
  unitName: string;
  rubric: {
    key: string;
    label: string;
    description: string;
    questions: string[];
    weight: number;
  }[];
  mine: Pick<Assessment, "scores" | "recommendation" | "note" | "relation"> | null;
}

/** "3.2 (2)": the average of each interviewer's weighted average, and how many assessed. */
export interface AssessmentPanel {
  score: string | null;
  /** "Score 3.2 (2 assessors)", under the status in the applicants list. */
  listLabel: string | null;
  spread: string;
  withRelation: number;
  items: {
    id: string;
    interviewer: string;
    unitName: string;
    average: string;
    recommendation: string;
    note: string;
    relation: string | null;
  }[];
  /** One form per booked interview, for someone who may assess. */
  forms: AssessmentForm[];
}

export function toAssessmentPanel(input: {
  booked: readonly string[];
  assessments: readonly Assessment[];
  rubric: readonly RubricAspect[];
  names: ReadonlyMap<string, string>;
  viewerUid: string;
  canAssess: boolean;
}): AssessmentPanel {
  const { names } = input;
  const summary = assessmentSummary(input.assessments);
  return {
    score: summary.average === null ? null : `${summary.average.toFixed(1)} (${summary.count})`,
    listLabel:
      summary.average === null
        ? null
        : `Score ${summary.average.toFixed(1)} (${summary.count} ${summary.count === 1 ? "assessor" : "assessors"})`,
    spread: RECOMMENDATIONS.filter((r) => summary.spread[r] > 0)
      .map((r) => `${summary.spread[r]} ${RECOMMENDATION_LABELS[r].toLowerCase()}`)
      .join(" · "),
    withRelation: summary.withRelation,
    items: input.assessments.map((a) => ({
      id: a.id,
      interviewer: names.get(a.uid) ?? a.uid,
      unitName: names.get(a.choiceId) ?? a.choiceId,
      average: (assessmentAverage(a) ?? 0).toFixed(1),
      recommendation: RECOMMENDATION_LABELS[a.recommendation],
      note: a.note,
      relation: a.relation === NO_RELATION ? null : a.relation,
    })),
    forms: input.canAssess
      ? input.booked.map((choiceId) => {
          const mine = input.assessments.find(
            (a) => a.choiceId === choiceId && a.uid === input.viewerUid,
          );
          const described = new Map(input.rubric.map((r) => [r.key, r]));
          // an assessment keeps the rubric it was scored with
          const aspects = mine?.rubric ?? input.rubric;
          return {
            choiceId,
            unitName: names.get(choiceId) ?? choiceId,
            rubric: aspects.map((a) => ({
              key: a.key,
              label: a.label,
              weight: a.weight,
              description: described.get(a.key)?.description ?? "",
              questions: [...(described.get(a.key)?.questions ?? [])],
            })),
            mine: mine ?? null,
          };
        })
      : [],
  };
}

export interface ApplicationItem {
  /** Visible assessments of this applicant (step 11.6); null when none were loaded. */
  assessment: AssessmentPanel | null;
  id: string;
  version: number;
  userId: string;
  name: string;
  email: string;
  status: ApplicationStatus;
  statusLabel: string;
  statusHint: string;
  /** "Japan · University of Tokyo" under the name; empty without a profile. */
  origin: string;
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
  assessment: AssessmentPanel | null = null,
  origin: { chapter: string | null; campus: string } | null = null,
): ApplicationItem {
  const unitName = (id: string) => r.units.find((u) => u.orgUnitId === id)?.name ?? id;
  const seatOf = (id: string, seat: AppointmentSeat) =>
    seatLabel(seat, { name: unitName(id), type: unitTypes.get(id) ?? "staf" });
  return {
    assessment,
    id: a.id,
    version: a.version,
    userId: a.userId,
    name: user?.name ?? user?.email ?? a.userId,
    email: user?.email ?? "",
    status: a.status,
    statusLabel: label(APPLICATION_STATUS_LABELS, a.status),
    statusHint: STATUS_HINTS[a.status],
    origin: [origin?.chapter, origin?.campus].filter(Boolean).join(" · "),
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
