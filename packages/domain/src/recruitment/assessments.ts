import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";

/** Step 11.6: the interview rubric. Scale 1-4, no middle. */
export const SCORE_LABELS = {
  1: "Not seen",
  2: "Weak / no example",
  3: "Clear, with a real example",
  4: "Outstanding",
} as const;

export interface RubricAspect {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly questions: readonly string[];
  /** 1-5; how much the aspect counts in the weighted average. */
  readonly weight: number;
}

export const DEFAULT_RUBRIC: readonly RubricAspect[] = [
  {
    key: "motivation",
    label: "Motivation and values",
    description: "Why the applicant wants to join and whether their values fit the organization.",
    questions: ["Why do you want to join, and why this unit?", "What do you hope to learn here?"],
    weight: 1,
  },
  {
    key: "time",
    label: "Time commitment",
    description: "Whether the applicant can give the time the unit needs, next to studies.",
    questions: [
      "How do you plan your week next to your studies?",
      "Which other commitments do you have this year?",
    ],
    weight: 1,
  },
  {
    key: "skills",
    label: "Skills for the unit",
    description: "Skills and experience that matter for the chosen unit.",
    questions: [
      "Which skills do you bring to this unit?",
      "Tell us about work you did that shows them.",
    ],
    weight: 1,
  },
  {
    key: "teamwork",
    label: "Teamwork and communication",
    description: "How the applicant works with others and explains their thinking.",
    questions: [
      "Describe a team you worked in and your part in it.",
      "How did you handle a disagreement in a team?",
    ],
    weight: 1,
  },
  {
    key: "initiative",
    label: "Initiative and responsibility",
    description: "Whether the applicant starts things and finishes what they promised.",
    questions: [
      "Tell us about something you started without being asked.",
      "Tell us about a promise that was hard to keep.",
    ],
    weight: 1,
  },
];

export const RubricInputSchema = z
  .array(
    z
      .object({
        key: safeId,
        label: safeText(80),
        description: safeText(500, { allowEmpty: true }),
        questions: z.array(safeText(300)).max(5),
        weight: z.number().int().min(1).max(5),
      })
      .strict(),
  )
  .min(1, "Keep at least one aspect.")
  .max(12)
  .refine(
    (aspects) => new Set(aspects.map((a) => a.key)).size === aspects.length,
    "Each key once.",
  );

/** What the committee stored; empty = the default rubric. */
export const rubricOf = (r: { readonly interviewRubric: readonly RubricAspect[] }) =>
  r.interviewRubric.length > 0 ? r.interviewRubric : DEFAULT_RUBRIC;

/** A rubric equal to the default is stored as empty. */
export const storableRubric = (rubric: readonly RubricAspect[]): readonly RubricAspect[] =>
  JSON.stringify(rubric) === JSON.stringify(DEFAULT_RUBRIC) ? [] : rubric;

export const RECOMMENDATIONS = [
  "strongly_recommended",
  "recommended",
  "unsure",
  "not_recommended",
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const NO_RELATION = "no close relation";

export interface Assessment {
  readonly id: string;
  /** `{applicationId}_{choiceId}`: the interview. */
  readonly interviewKey: string;
  readonly applicationId: string;
  readonly recruitmentId: string;
  readonly choiceId: string;
  readonly uid: string;
  /** Copy of the rubric (key, label, weight) taken at the first save; a later rubric change never alters it. */
  readonly rubric: ReadonlyArray<Pick<RubricAspect, "key" | "label" | "weight">>;
  readonly scores: Readonly<Record<string, number>>;
  /** Chosen by the interviewer, never computed. */
  readonly recommendation: Recommendation;
  readonly note: string;
  readonly relation: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const interviewKey = (applicationId: string, choiceId: string) =>
  `${applicationId}_${choiceId}`;
export const assessmentId = (key: string, uid: string) => `${key}_${uid}`;

export const AssessmentInputSchema = z
  .object({
    id: safeId,
    choiceId: safeId,
    scores: z.record(safeId, z.number().int().min(1).max(4)),
    recommendation: z.enum(RECOMMENDATIONS),
    note: safeText(2000, { multiline: true, allowEmpty: true }),
    relation: safeText(500),
  })
  .strict();
export type AssessmentInput = z.output<typeof AssessmentInputSchema>;

/** Every aspect scored; a note when a score is 1 or 4, or the recommendation is "not recommended". */
export function checkAssessment(
  rubric: ReadonlyArray<Pick<RubricAspect, "key">>,
  input: Pick<AssessmentInput, "scores" | "recommendation" | "note">,
): void {
  const keys = Object.keys(input.scores);
  if (keys.length !== rubric.length || rubric.some((a) => input.scores[a.key] === undefined)) {
    throw new RuleViolationError("Score every aspect of the rubric.");
  }
  const extreme = Object.values(input.scores).some((s) => s === 1 || s === 4);
  if ((extreme || input.recommendation === "not_recommended") && input.note === "") {
    throw new RuleViolationError(
      'Add a note: a score of 1 or 4, or "not recommended", needs a reason.',
    );
  }
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** Pure and shared with the officer assessment (step 9.3): sum(score x weight) / sum(weight). */
export function weightedAverage(
  items: ReadonlyArray<{ readonly score: number; readonly weight: number }>,
): number | null {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  return total === 0 ? null : items.reduce((sum, i) => sum + i.score * i.weight, 0) / total;
}

export const assessmentAverage = (a: Pick<Assessment, "rubric" | "scores">) =>
  weightedAverage(a.rubric.map((r) => ({ score: a.scores[r.key] ?? 0, weight: r.weight })));

/** The average of each assessment's weighted average (one decimal), and how many assessments. */
export function assessmentSummary(list: readonly Assessment[]) {
  const averages = list.flatMap((a) => assessmentAverage(a) ?? []);
  const spread = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, 0])) as Record<
    Recommendation,
    number
  >;
  for (const a of list) spread[a.recommendation] += 1;
  return {
    average: averages.length
      ? oneDecimal(averages.reduce((sum, n) => sum + n, 0) / averages.length)
      : null,
    count: list.length,
    spread,
    withRelation: list.filter((a) => a.relation !== NO_RELATION).length,
  };
}

/** Another interviewer's assessment of an interview is visible only after you sent yours; the committee sees all. */
export function visibleAssessments<T extends Pick<Assessment, "interviewKey" | "uid">>(
  all: readonly T[],
  uid: string,
  review: boolean,
): T[] {
  const mine = new Set(all.filter((a) => a.uid === uid).map((a) => a.interviewKey));
  return all.filter((a) => review || mine.has(a.interviewKey));
}
