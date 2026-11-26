import { describe, expect, it } from "vitest";
import {
  QuestionInputSchema,
  answerColumns,
  answersSchema,
  parseAnswers,
  responseTable,
  summarizeResponses,
  type FormVersion,
  type Question,
  type QuestionType,
} from "@website/domain/forms";

const input = (type: QuestionType, extra: Record<string, unknown> = {}) => ({
  id: "",
  type,
  label: "Question",
  description: "",
  required: true,
  options: [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});
const q = (id: string, type: QuestionType, extra: Partial<Question> = {}): Question => ({
  id,
  type,
  label: `Q ${id}`,
  description: "",
  required: false,
  options: [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});
const ok = (questions: Question[], answers: unknown) => parseAnswers(questions, answers).ok;

describe("new question types (N2.1)", () => {
  it("a section heading is never required, has no options and takes no answer", () => {
    expect(
      QuestionInputSchema.parse(input("section", { options: ["a"], required: true })),
    ).toMatchObject({
      type: "section",
      required: false,
      options: [],
    });
    const questions = [q("q_s", "section"), q("q_a", "short_text", { required: true })];
    expect(ok(questions, { q_a: "x" })).toBe(true);
    expect(ok(questions, { q_a: "x", q_s: "hello" })).toBe(false);
  });

  it("rating is a whole number 1-5, scale 1-10", () => {
    const rating = [q("q_r", "rating")];
    const scale = [q("q_c", "scale")];
    for (const v of [1, 5]) expect(ok(rating, { q_r: v })).toBe(true);
    for (const v of [0, 6, 2.5, "3"]) expect(ok(rating, { q_r: v })).toBe(false);
    for (const v of [1, 10]) expect(ok(scale, { q_c: v })).toBe(true);
    for (const v of [0, 11, 7.5]) expect(ok(scale, { q_c: v })).toBe(false);
  });

  it("a scale keeps both end labels or none", () => {
    expect(
      QuestionInputSchema.safeParse(input("scale", { options: ["Bad", "Great"] })).success,
    ).toBe(true);
    expect(QuestionInputSchema.safeParse(input("scale")).success).toBe(true);
    expect(QuestionInputSchema.safeParse(input("scale", { options: ["Bad"] })).success).toBe(false);
  });

  it("time, phone and link are checked", () => {
    const time = [q("q_t", "time")];
    expect(ok(time, { q_t: "09:30" })).toBe(true);
    expect(ok(time, { q_t: "24:00" })).toBe(false);
    expect(ok(time, { q_t: "9:30" })).toBe(false);
    const phone = [q("q_p", "phone")];
    expect(ok(phone, { q_p: "+62 812-3456-7890" })).toBe(true);
    expect(ok(phone, { q_p: "0812345678" })).toBe(false);
    expect(ok(phone, { q_p: "+12" })).toBe(false);
    const link = [q("q_l", "link")];
    expect(ok(link, { q_l: "https://ppidk.example/page?x=1" })).toBe(true);
    expect(ok(link, { q_l: "http://ppidk.example" })).toBe(false);
    expect(ok(link, { q_l: "javascript:alert(1)" })).toBe(false);
    expect(ok(link, { q_l: "https://" })).toBe(false);
  });

  it("a dropdown is a single choice from its options, with no other answer", () => {
    const parsed = QuestionInputSchema.parse(
      input("dropdown", { options: ["A", "B"], allowOther: true }),
    );
    expect(parsed).toMatchObject({ options: ["A", "B"], allowOther: false });
    const dropdown = [q("q_d", "dropdown", { options: ["A", "B"] })];
    expect(ok(dropdown, { q_d: "A" })).toBe(true);
    expect(ok(dropdown, { q_d: "C" })).toBe(false);
    expect(QuestionInputSchema.safeParse(input("dropdown", { options: ["A"] })).success).toBe(
      false,
    );
  });

  it("section headings are not columns of the export", () => {
    const version: FormVersion = {
      formId: "f",
      number: 1,
      questions: [q("q_s", "section"), q("q_a", "rating")],
      answered: true,
      createdAt: new Date("2026-10-01T00:00:00Z"),
    };
    expect([...answerColumns([version]).keys()]).toEqual(["q_a"]);
    const table = responseTable(
      [version],
      [
        {
          id: "r",
          formId: "f",
          version: 1,
          answers: { q_a: 4 },
          submittedAt: new Date("2026-10-02T00:00:00Z"),
        },
      ],
    );
    expect(table.header.at(-1)).toBe("Q q_a");
    expect(table.rows[0]?.at(-1)).toBe("4");
    expect(answersSchema(version.questions)).toBeDefined();
  });
});

describe("results summary (N2.1)", () => {
  const r = (answers: Record<string, unknown>) => ({ answers: answers as never });

  it("counts choices with percent of the people who answered, and groups other answers", () => {
    const questions = [q("q_c", "multi_choice", { options: ["A", "B"], allowOther: true })];
    const [s] = summarizeResponses(questions, [
      r({ q_c: ["A", "B"] }),
      r({ q_c: ["A"] }),
      r({ q_c: ["Zed"] }),
      r({}),
    ]);
    expect(s).toMatchObject({
      kind: "choice",
      answered: 3,
      rows: [
        { label: "A", count: 2, percent: 67 },
        { label: "B", count: 1, percent: 33 },
        { label: "Other", count: 1, percent: 33 },
      ],
    });
  });

  it("gives ratings a distribution and an average, per question (1-5 and 1-10 never mix)", () => {
    const questions = [q("q_r", "rating"), q("q_s", "scale")];
    const answers = [r({ q_r: 5, q_s: 10 }), r({ q_r: 4, q_s: 8 }), r({ q_r: 4, q_s: 9 })];
    const [rating, scale] = summarizeResponses(questions, answers);
    expect(rating).toMatchObject({ kind: "rating", max: 5, answered: 3, average: 4.3 });
    expect(rating?.kind === "rating" && rating.rows.map((x) => x.count)).toEqual([0, 0, 0, 2, 1]);
    expect(scale).toMatchObject({ kind: "rating", max: 10, average: 9 });
    expect(scale?.kind === "rating" && scale.rows).toHaveLength(10);
  });

  it("gives numbers min, average and max, and text the latest answers", () => {
    const questions = [q("q_n", "number"), q("q_t", "short_text")];
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => r({ q_n: n * 10, q_t: `t${n}` }));
    const [num, text] = summarizeResponses(questions, rows);
    expect(num).toMatchObject({ kind: "number", answered: 7, min: 10, average: 40, max: 70 });
    expect(text).toMatchObject({
      kind: "text",
      answered: 7,
      latest: ["t1", "t2", "t3", "t4", "t5"],
    });
  });

  it("an empty form gives empty summaries and headings or files are left out", () => {
    const [num, rating] = summarizeResponses(
      [q("q_n", "number"), q("q_r", "rating"), q("q_s", "section"), q("q_f", "file")],
      [],
    );
    expect(num).toMatchObject({ answered: 0, min: null, average: null, max: null });
    expect(rating).toMatchObject({ answered: 0, average: null });
    expect(summarizeResponses([q("q_s", "section"), q("q_f", "file")], [r({})])).toEqual([]);
  });
});
