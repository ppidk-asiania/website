import "server-only";
import { z } from "zod";
import { RuleViolationError } from "@website/domain/shared";
import type { OwnFormData, SignedInAccount, SubmitOutcome } from "@website/db/sql";
import {
  toPublicForm,
  type Form,
  type FormVersion,
  type PublicAnswerState,
  type PublicForm,
} from "@website/domain/forms";

export type FormView = {
  readonly form: PublicForm;
  readonly state: PublicAnswerState;
  readonly mine: OwnFormData | null;
};

export function createPublicFormReader(deps: {
  readonly find: (
    token: string,
    user: SignedInAccount | null,
  ) => Promise<{
    form: Form;
    version: FormVersion;
    state: PublicAnswerState;
    mine: OwnFormData | null;
  } | null>;
}) {
  return async (token: string, user: SignedInAccount | null = null): Promise<FormView | null> => {
    const found = await deps.find(token, user);
    return (
      found && {
        form: toPublicForm(found.form, found.version),
        state: found.state,
        mine: found.mine,
      }
    );
  };
}

export interface FormSubmissionDeps {
  readonly submit: (
    token: string,
    version: number,
    answers: unknown,
    now: Date,
    who: { user: SignedInAccount | null; guest: unknown },
  ) => Promise<SubmitOutcome>;
  readonly captcha: (token: string) => Promise<boolean>;
  readonly now: () => Date;
}

export type FormSubmitResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | "invalid"
        | "captcha"
        | "not_found"
        | "closed"
        | "changed"
        | "signin"
        | "officers"
        | "committee"
        | "guest";
    }
  | {
      readonly ok: false;
      readonly error: "answers";
      readonly fields: Readonly<Record<string, string>>;
    };

const Input = z
  .object({
    token: z.string().max(64),
    version: z.number().int().min(1),
    answers: z.record(z.string().max(40), z.unknown()),
    guest: z.unknown().optional(),
    captcha: z.string().max(4000),
  })
  .strict();

export function createFormSubmission(deps: FormSubmissionDeps) {
  return async (user: SignedInAccount | null, input: unknown): Promise<FormSubmitResult> => {
    const parsed = Input.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!(await deps.captcha(parsed.data.captcha))) return { ok: false, error: "captcha" };
    const { token, version, answers, guest } = parsed.data;
    try {
      return await deps.submit(token, version, answers, deps.now(), { user, guest });
    } catch (error) {
      // A committee evaluation answered by someone outside the committee or outside its window.
      if (error instanceof RuleViolationError) return { ok: false, error: "committee" };
      throw error;
    }
  };
}
