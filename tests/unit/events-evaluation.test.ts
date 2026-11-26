import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVALUATION,
  EvaluationInputSchema,
  entitledToCertificate,
  evaluationWindow,
} from "@website/domain/events";

describe("who earns a certificate (N1.7)", () => {
  const rules = { needsAttendance: true, needsEvaluation: true };
  const present = { status: "confirmed", checkedIn: true } as const;

  it("needs a confirmed registration first", () => {
    for (const status of ["pending", "waitlisted", "cancelled"] as const) {
      expect(entitledToCertificate({ status, checkedIn: true }, rules, true)).toEqual({
        entitled: false,
        reason: "not_confirmed",
      });
    }
  });

  it("then attendance, when the event asks for it", () => {
    const absent = { status: "confirmed", checkedIn: false } as const;
    expect(entitledToCertificate(absent, rules, true)).toEqual({
      entitled: false,
      reason: "not_attended",
    });
    expect(entitledToCertificate(absent, { ...rules, needsAttendance: false }, true)).toEqual({
      entitled: true,
    });
  });

  it("then the evaluation, only when the evaluation is a condition", () => {
    expect(entitledToCertificate(present, rules, false)).toEqual({
      entitled: false,
      reason: "not_evaluated",
    });
    expect(entitledToCertificate(present, { ...rules, needsEvaluation: false }, false)).toEqual({
      entitled: true,
    });
    expect(entitledToCertificate(present, rules, true)).toEqual({ entitled: true });
  });
});

describe("committee evaluation window", () => {
  const opens = new Date("2026-11-21T00:00:00Z");
  const closes = new Date("2026-11-28T00:00:00Z");
  const set = { committeeFormId: "f", committeeOpensAt: opens, committeeClosesAt: closes };

  it("is computed when read: not set, before, open, closed", () => {
    expect(evaluationWindow(DEFAULT_EVALUATION, opens)).toBe("not_set");
    expect(evaluationWindow({ ...set, committeeClosesAt: null }, opens)).toBe("not_set");
    expect(evaluationWindow(set, new Date(opens.getTime() - 1))).toBe("before");
    expect(evaluationWindow(set, opens)).toBe("open");
    expect(evaluationWindow(set, closes)).toBe("open");
    expect(evaluationWindow(set, new Date(closes.getTime() + 1))).toBe("closed");
  });
});

describe("evaluation input", () => {
  const ok = { ...DEFAULT_EVALUATION };
  const refused = (input: unknown) => !EvaluationInputSchema.safeParse(input).success;

  it("accepts the defaults and a committee form with a window", () => {
    expect(EvaluationInputSchema.safeParse(ok).success).toBe(true);
    expect(
      EvaluationInputSchema.safeParse({
        ...ok,
        committeeFormId: "c1",
        committeeOpensAt: "2026-11-21T00:00:00Z",
        committeeClosesAt: "2026-11-28T00:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("refuses one form for both, a window without a form and a window that closes before it opens", () => {
    expect(refused({ ...ok, formId: "a", committeeFormId: "a" })).toBe(true);
    expect(refused({ ...ok, committeeOpensAt: "2026-11-21T00:00:00Z" })).toBe(true);
    expect(
      refused({
        ...ok,
        committeeFormId: "c1",
        committeeOpensAt: "2026-11-28T00:00:00Z",
        committeeClosesAt: "2026-11-21T00:00:00Z",
      }),
    ).toBe(true);
  });
});
