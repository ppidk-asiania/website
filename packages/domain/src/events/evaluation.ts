import { z } from "zod";
import { safeId } from "@website/security/validation";
import type { RegistrationStatus } from "./index";

/**
 * Evaluation of an event (N1.7). The participant form and the committee form are ordinary public forms of the
 * Forms page. Whether the participant evaluation is anonymous is the form's own mode (`anonymous` or `guest`
 * versus `account`): an anonymous form cannot be a condition for a certificate, because nobody knows who
 * answered.
 */
export interface EvaluationSettings {
  readonly formId: string | null;
  readonly certificateNeedsAttendance: boolean;
  readonly committeeFormId: string | null;
  readonly committeeOpensAt: Date | null;
  readonly committeeClosesAt: Date | null;
}

export const DEFAULT_EVALUATION: EvaluationSettings = {
  formId: null,
  certificateNeedsAttendance: true,
  committeeFormId: null,
  committeeOpensAt: null,
  committeeClosesAt: null,
};

export const EvaluationInputSchema = z
  .object({
    formId: safeId.nullable(),
    certificateNeedsAttendance: z.boolean(),
    committeeFormId: safeId.nullable(),
    committeeOpensAt: z.coerce.date().nullable(),
    committeeClosesAt: z.coerce.date().nullable(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    if (e.committeeFormId !== null && e.committeeFormId === e.formId) {
      issue("The committee needs its own form.", "committeeFormId");
    }
    if (e.committeeFormId === null && (e.committeeOpensAt || e.committeeClosesAt)) {
      issue("Choose the committee form for this window.", "committeeFormId");
    }
    if (
      e.committeeOpensAt &&
      e.committeeClosesAt &&
      e.committeeClosesAt.getTime() <= e.committeeOpensAt.getTime()
    ) {
      issue("The window must close after it opens.", "committeeClosesAt");
    }
  });

export type EvaluationWindow = "not_set" | "before" | "open" | "closed";

/** Computed when read: the committee evaluation has a form and a window, and `now` is before, inside or after. */
export function evaluationWindow(
  s: Pick<EvaluationSettings, "committeeFormId" | "committeeOpensAt" | "committeeClosesAt">,
  now: Date,
): EvaluationWindow {
  if (s.committeeFormId === null || !s.committeeOpensAt || !s.committeeClosesAt) return "not_set";
  if (now < s.committeeOpensAt) return "before";
  return now <= s.committeeClosesAt ? "open" : "closed";
}

export type CertificateGap = "not_confirmed" | "not_attended" | "not_evaluated";

/**
 * The one rule of who earns a participant certificate: a confirmed registration, and (when the event says so)
 * attendance, and (when it has an evaluation filled in with an account) an answered evaluation.
 */
export function entitledToCertificate(
  registration: { status: RegistrationStatus; checkedIn: boolean },
  rules: { needsAttendance: boolean; needsEvaluation: boolean },
  evaluated: boolean,
): { entitled: true } | { entitled: false; reason: CertificateGap } {
  if (registration.status !== "confirmed") return { entitled: false, reason: "not_confirmed" };
  if (rules.needsAttendance && !registration.checkedIn) {
    return { entitled: false, reason: "not_attended" };
  }
  if (rules.needsEvaluation && !evaluated) return { entitled: false, reason: "not_evaluated" };
  return { entitled: true };
}
