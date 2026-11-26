import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  createSqlCommitteeStore,
  createSqlEventReader,
  createSqlFormWebStore,
  createSqlRegistrationStore,
  type SignedInAccount,
} from "@website/db/sql";
import { checkInOutcome, registrationId, type PublicEvent } from "@website/domain/events";
import { keyedHash, sha256Hex } from "@website/security";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb, webStorage } from "./db";
import { randomUUID } from "node:crypto";
import { createEventProofUpload } from "./event-proof";
import { getWebEnv } from "./env";
import { messenger } from "./messaging";
import { hasCompleteProfile } from "./profile-wiring";
import { formWindow } from "@website/domain/forms";
import { publicFormByToken, publishedPublicForms } from "./forms-wiring";
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

const committees = lazyEnv(() => createSqlCommitteeStore(webDb()));

/** The open forms an event links to fill its committee (N1.6): volunteer sign-up and committee applications. */
export async function eventCommitteeCalls(eventId: string, now: Date) {
  const links = (await committees().get(eventId))?.applicationForms ?? [];
  if (links.length === 0) return [];
  const open = await publishedPublicForms();
  return links.flatMap((link) => {
    const form = open.find((f) => f.id === link.formId);
    return form && form.publicToken && formWindow(form, now) === "open"
      ? [{ kind: link.kind, title: form.title, token: form.publicToken }]
      : [];
  });
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

/** The proof of a payment made outside the platform (N1.3). */
export const uploadEventProof = lazyEnv(() =>
  createEventProofUpload({
    events: reader(),
    registrations: registrations(),
    storage: webStorage(),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

/**
 * What the ticket page shows: the event, how to pay (paid events) and the member's own registration (null: not
 * theirs to see). A confirmed registration also gets its QR token (N1.4): the token is derived from a keyed hash
 * of the registration id, so it can be shown again at any time, and only its hash is stored for the scanner.
 */
export async function eventTicket(slug: string, user: SignedInAccount) {
  const found = await reader().findTicketEvent(slug);
  if (!found) return null;
  const mine = await registrations().ownRegistration(found.event.id, user.uid);
  if (!mine) return null;
  const secret = getWebEnv().SUBSCRIBER_HASH_SECRET;
  const mayEnter = checkInOutcome({ ...mine, checkedInAt: null }) === "checked_in";
  let ticketToken: string | null = null;
  if (mayEnter && secret) {
    ticketToken = keyedHash("event-ticket", registrationId(found.event.id, user.uid), secret).slice(
      0,
      32,
    );
    await registrations().setTicketHash(
      found.event.id,
      user.uid,
      sha256Hex(new TextEncoder().encode(ticketToken)),
    );
  }
  return { ...found, mine, ticketToken };
}
