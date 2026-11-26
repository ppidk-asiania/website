import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlCommitteeStore, createSqlFormWebStore } from "@website/db/sql";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { RuleViolationError } from "@website/domain/shared";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { createFormSubmission, createPublicFormReader } from "./forms";

const store = lazyEnv(() => createSqlFormWebStore(webDb()));
const committees = lazyEnv(() => createSqlCommitteeStore(webDb()));

export const publicFormByToken = lazyEnv(() =>
  createPublicFormReader({ find: (token, user) => store().findPublic(token, new Date(), user) }),
);

export async function publishedPublicForms() {
  "use cache";
  cacheTag("forms");
  cacheLife("minutes");
  return store().listPublished();
}

export const submitPublicForm = lazyEnv(() => {
  const env = getWebEnv();
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return createFormSubmission({
    // A committee evaluation form is answered only by the committee, inside its window (N1.7).
    submit: (token, version, answers, now, who) =>
      store().submit(token, version, answers, now, who, async (tx, saved) => {
        const refused = await committees().refuseCommitteeAnswer(
          tx,
          saved.formId,
          who.user?.uid ?? null,
          now,
        );
        if (refused) throw new RuleViolationError("Only the committee answers this form now.");
      }),
    captcha: (token) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "form_submit",
      ),
    now: () => new Date(),
  });
});
