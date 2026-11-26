import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { randomUUID } from "node:crypto";
import {
  createSqlContributionWebStore,
  createSqlInventoryReader,
  createSqlLoanWebStore,
} from "@website/db/sql";
import type { PublicItem } from "@website/domain/inventory";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb, webStorage } from "./db";
import { getWebEnv } from "./env";
import { createContributionOffers } from "./contribution-offers";
import { createLoanRequests } from "./loan-requests";
import { messenger } from "./messaging";
import { hasCompleteProfile } from "./profile-wiring";

const reader = lazyEnv(() => createSqlInventoryReader(webDb()));

/** Listed items with "N available"; cached for a minute or two (stock moves slowly). */
export async function catalogue(): Promise<PublicItem[]> {
  "use cache";
  cacheTag("inventory");
  cacheLife("minutes");
  return reader().catalogue();
}

const loans = lazyEnv(() => createSqlLoanWebStore(webDb()));

/** The signed-in member's own requests; read per request, never cached. */
export const myLoans = (uid: string) => loans().mine(uid);

export const loanRequests = lazyEnv(() => {
  const env = getWebEnv();
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return createLoanRequests({
    loans: loans(),
    storage: webStorage(),
    send: (message, key) => messenger().send(message, key),
    captcha: (token) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "loan_request",
      ),
    profileComplete: hasCompleteProfile,
    now: () => new Date(),
    uuid: randomUUID,
  });
});

const offers = lazyEnv(() => createSqlContributionWebStore(webDb()));

/** The signed-in member's own offered items; read per request, never cached. */
export const myOffers = (uid: string) => offers().mine(uid);

export const contributionOffers = lazyEnv(() =>
  createContributionOffers({
    offers: offers(),
    profileComplete: hasCompleteProfile,
    now: () => new Date(),
    uuid: randomUUID,
  }),
);
