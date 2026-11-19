import { describe, expect, it } from "vitest";
import { toAssessmentPanel } from "../../apps/admin/src/components/applications-model";
import {
  AssessmentInputSchema,
  assessmentSummary,
  checkAssessment,
  DEFAULT_RUBRIC,
  RubricInputSchema,
  rubricOf,
  visibleAssessments,
  weightedAverage,
  type Assessment,
} from "@website/domain/recruitment";

const keys = DEFAULT_RUBRIC.map((a) => a.key);
const scoresOf = (...values: number[]) => Object.fromEntries(keys.map((k, i) => [k, values[i]!]));
const made = (uid: string, ...values: number[]): Assessment => ({
  id: `k_${uid}`,
  interviewKey: "k",
  applicationId: "a",
  recruitmentId: "r",
  choiceId: "finance",
  uid,
  rubric: DEFAULT_RUBRIC.map(({ key, label, weight }) => ({ key, label, weight })),
  scores: scoresOf(...values),
  recommendation: "recommended",
  note: "",
  relation: "no close relation",
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe("default rubric (11.6)", () => {
  it("has five aspects with two guide questions each and weight 1", () => {
    expect(DEFAULT_RUBRIC).toHaveLength(5);
    for (const a of DEFAULT_RUBRIC) {
      expect(a.questions).toHaveLength(2);
      expect(a.weight).toBe(1);
    }
    expect(RubricInputSchema.safeParse(DEFAULT_RUBRIC).success).toBe(true);
  });

  it("is used while nothing is stored, and weights stay 1-5 with unique keys", () => {
    expect(rubricOf({ interviewRubric: [] })).toBe(DEFAULT_RUBRIC);
    const [first] = DEFAULT_RUBRIC;
    expect(RubricInputSchema.safeParse([{ ...first, weight: 6 }]).success).toBe(false);
    expect(RubricInputSchema.safeParse([first, first]).success).toBe(false);
  });
});

describe("weighted average and average of averages", () => {
  it("weights the scores of one assessment", () => {
    expect(weightedAverage([])).toBeNull();
    expect(
      weightedAverage([
        { score: 4, weight: 3 },
        { score: 1, weight: 1 },
      ]),
    ).toBe(3.25);
  });

  it("averages each interviewer's weighted average, one decimal", () => {
    const summary = assessmentSummary([made("a", 3, 3, 3, 3, 3), made("b", 4, 3, 3, 3, 4)]);
    expect(summary).toMatchObject({ average: 3.2, count: 2 });
    expect(assessmentSummary([])).toMatchObject({ average: null, count: 0 });
  });

  it("counts recommendations and declared relations", () => {
    const b = {
      ...made("b", 2, 2, 2, 2, 2),
      recommendation: "unsure" as const,
      relation: "cousin",
    };
    expect(assessmentSummary([made("a", 3, 3, 3, 3, 3), b])).toMatchObject({
      spread: { recommended: 1, unsure: 1, strongly_recommended: 0, not_recommended: 0 },
      withRelation: 1,
    });
  });
});

describe("assessment rules", () => {
  const input = (patch: Record<string, unknown> = {}) => ({
    id: "a",
    choiceId: "finance",
    scores: scoresOf(3, 3, 3, 3, 3),
    recommendation: "recommended" as const,
    note: "",
    relation: "no close relation",
    ...patch,
  });
  const check = (patch: Record<string, unknown> = {}) =>
    checkAssessment(DEFAULT_RUBRIC, AssessmentInputSchema.parse(input(patch)));

  it("accepts a complete assessment and demands every aspect, scored 1-4", () => {
    expect(() => check()).not.toThrow();
    expect(
      AssessmentInputSchema.safeParse(input({ scores: scoresOf(5, 3, 3, 3, 3) })).success,
    ).toBe(false);
    expect(() => check({ scores: { [keys[0]!]: 3 } })).toThrow();
  });

  it("needs a note for a 1, a 4 or 'not recommended'", () => {
    expect(() => check({ scores: scoresOf(4, 3, 3, 3, 3) })).toThrow(/note/i);
    expect(() => check({ scores: scoresOf(1, 3, 3, 3, 3), note: "no example" })).not.toThrow();
    expect(() => check({ recommendation: "not_recommended" })).toThrow(/note/i);
    expect(() => check({ recommendation: "not_recommended", note: "late twice" })).not.toThrow();
  });

  it("needs a relation statement", () => {
    expect(AssessmentInputSchema.safeParse(input({ relation: "" })).success).toBe(false);
  });
});

describe("application page panel", () => {
  it('shows "3.2 (2)" and the list label, with a form per booked interview', () => {
    const panel = toAssessmentPanel({
      booked: ["finance"],
      assessments: [made("a", 3, 3, 3, 3, 3), made("b", 4, 3, 3, 3, 4)],
      rubric: DEFAULT_RUBRIC,
      names: new Map([["a", "Ayu"]]),
      viewerUid: "a",
      canAssess: true,
    });
    expect(panel).toMatchObject({ score: "3.2 (2)", listLabel: "Score 3.2 (2 assessors)" });
    expect(panel.items[0]).toMatchObject({ interviewer: "Ayu", average: "3.0", relation: null });
    expect(panel.forms).toHaveLength(1);
    expect(panel.forms[0]!.mine).not.toBeNull();
    expect(
      toAssessmentPanel({
        ...{
          booked: [],
          assessments: [],
          rubric: DEFAULT_RUBRIC,
          names: new Map(),
          viewerUid: "a",
        },
        canAssess: false,
      }),
    ).toMatchObject({ score: null, forms: [] });
  });
});

describe("who sees which assessment", () => {
  const all = [made("a", 3, 3, 3, 3, 3), made("b", 4, 4, 4, 4, 4)];
  it("shows others only after you sent yours; the committee sees all", () => {
    expect(visibleAssessments(all, "c", false)).toEqual([]);
    expect(visibleAssessments(all, "a", false)).toHaveLength(2);
    expect(visibleAssessments(all, "c", true)).toHaveLength(2);
  });
});
