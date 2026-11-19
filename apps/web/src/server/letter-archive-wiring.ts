import "server-only";
import { lazyEnv } from "@website/config/env";
import { createSqlLetterArchive } from "@website/db/sql";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { createLetterArchive } from "./letter-archive";

export const letterArchive = lazyEnv(() => {
  const env = getWebEnv();
  const secret = env.LINK_SIGNING_SECRET;
  if (!secret) throw new Error("LINK_SIGNING_SECRET is required.");
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return createLetterArchive({
    archive: createSqlLetterArchive(webDb()),
    captcha: (token) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "letter_archive",
      ),
    secret,
    now: () => new Date(),
  });
});
