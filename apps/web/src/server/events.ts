import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  createSqlEventReader,
  createSqlFormWebStore,
  createSqlRegistrationStore,
  type SignedInAccount,
} from "@website/db/sql";
import type { PublicEvent } from "@website/domain/events";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { messenger } from "./messaging";
import { hasCompleteProfile } from "./profile-wiring";
import { publicFormByToken } from "./forms-wiring";
import {
  createEventFormRegistration,
  createEventRegistration,
  createFormRegistrationTransaction,
} from "./registrations";

const reader = lazyEnv(() => createSqlEventReader(webDb()));
export const registrations = lazyEnv(() => createSqlRegistrationStore(webDb()));

export async function publicEvents(): Promise<PublicEvent[]> {
  "use cache";
  cacheTag("events");
  cacheLife("minutes");
  return reader().listPublished();
}

export async function publicEventBySlug(slug: string): Promise<PublicEvent | null> {
  "use cache";
  cacheTag("events");
  cacheLife("minutes");
  return reader().findPublishedBySlug(slug);
}

const forms = lazyEnv(() => createSqlFormWebStore(webDb()));

const registrationDeps = () => {
  const env = getWebEnv();
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return {
    findEvent: (slug: string) => reader().findPublishedBySlug(slug),
    captcha: (token: string) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "event_register",
      ),
    send: (message: Parameters<ReturnType<typeof messenger>["send"]>[0], key: string) =>
      messenger().send(message, key),
    profileComplete: hasCompleteProfile,
    now: () => new Date(),
  };
};

export const registerForEvent = lazyEnv(() =>
  createEventRegistration({
    ...registrationDeps(),
    register: (eventId, userId, now) => registrations().register(eventId, userId, now),
  }),
);

/** The wizard of an event that asks questions: one submit writes the registration and the answers. */
export const registerForEventWithForm = lazyEnv(() =>
  createEventFormRegistration({
    ...registrationDeps(),
    registerWithForm: createFormRegistrationTransaction({
      forms: forms(),
      registrations: registrations(),
    }),
  }),
);

/** The event and the form it asks, as the signed-in member sees them (null: no such event or no form). */
export async function eventRegistrationWizard(slug: string, user: SignedInAccount) {
  const event = await reader().findPublishedBySlug(slug);
  if (!event) return null;
  const setup = await registrations().setupOf(event.id);
  const token = setup && (await forms().tokenOf(setup.formId));
  const view = token ? await publicFormByToken()(token, user) : null;
  return { event, hasForm: setup !== null, view };
}
