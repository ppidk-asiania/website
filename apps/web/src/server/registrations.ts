import "server-only";
import { z } from "zod";
import type { SqlFormWebStore, SqlRegistrationStore } from "@website/db/sql";
import type { Message } from "@website/domain/messaging";
import {
  ATTENDANCE_MODES,
  assertAttendanceMode,
  type AttendanceMode,
  type PublicEvent,
  type RegistrationStatus,
} from "@website/domain/events";
import { parseAnswers } from "@website/domain/forms";
import { isValidSlug, RuleViolationError } from "@website/domain/shared";
import { DICTIONARIES, type Language } from "../i18n/dictionaries";

export interface RegistrationDeps {
  readonly findEvent: (slug: string) => Promise<PublicEvent | null>;
  readonly register: (
    eventId: string,
    userId: string,
    now: Date,
  ) => Promise<{ status: RegistrationStatus; created: boolean }>;
  readonly captcha: (token: string) => Promise<boolean>;
  readonly send: (message: Message, key: string) => Promise<unknown>;
  readonly profileComplete: (userId: string) => Promise<boolean>;
  readonly now: () => Date;
}

export type RegistrationResult =
  | { ok: true; status: RegistrationStatus }
  | { ok: false; error: "signin" | "profile" | "invalid" | "captcha" | "closed" };

const Input = z
  .object({ slug: z.string().refine(isValidSlug), token: z.string().max(4000) })
  .strict();

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function confirmByEmail(
  deps: Pick<RegistrationDeps, "send">,
  event: Pick<PublicEvent, "id" | "title">,
  user: { uid: string; email: string | null },
  status: RegistrationStatus,
  language: Language,
) {
  const t = DICTIONARIES[language].events;
  const line = status === "confirmed" ? t.mailConfirmed : t.mailWaitlisted;
  await deps.send(
    {
      channel: "email",
      to: user.email,
      subject: `${t.mailSubject}: ${event.title}`,
      text: `${line}\n\n${event.title}`,
      html: `<p>${escapeHtml(line)}</p><p><strong>${escapeHtml(event.title)}</strong></p>`,
    },
    `event:${event.id}:registered:${user.uid}`,
  );
}

export function createEventRegistration(deps: RegistrationDeps) {
  return async (
    user: { uid: string; email: string | null } | null,
    input: unknown,
    language: Language,
  ): Promise<RegistrationResult> => {
    if (!user) return { ok: false, error: "signin" };
    const parsed = Input.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!(await deps.captcha(parsed.data.token))) return { ok: false, error: "captcha" };
    if (!(await deps.profileComplete(user.uid))) return { ok: false, error: "profile" };
    const event = await deps.findEvent(parsed.data.slug);
    if (!event) return { ok: false, error: "closed" };
    let result: { status: RegistrationStatus; created: boolean };
    try {
      result = await deps.register(event.id, user.uid, deps.now());
    } catch (error) {
      if (error instanceof RuleViolationError) return { ok: false, error: "closed" };
      throw error;
    }
    if (result.created) await confirmByEmail(deps, event, user, result.status, language);
    return { ok: true, status: result.status };
  };
}

export type FormRegistrationResult =
  | { ok: true; status: RegistrationStatus; practice: boolean }
  | {
      ok: false;
      error: "signin" | "profile" | "invalid" | "captcha" | "closed" | "changed" | "mode";
    }
  | { ok: false; error: "answers"; fields: Readonly<Record<string, string>> };

type Account = { uid: string; email: string | null; name?: string | null };

/**
 * One submit writes the registration and the form response in one transaction (N1.2); practice mode
 * checks everything and stores nothing. The event's form is an ordinary account-mode form.
 */
export function createFormRegistrationTransaction(stores: {
  forms: Pick<SqlFormWebStore, "tokenOf" | "findPublic" | "submit">;
  registrations: Pick<SqlRegistrationStore, "registerIn" | "setupOf">;
}) {
  return async (
    event: Pick<PublicEvent, "id">,
    user: Account,
    input: { version: number; attendanceMode: AttendanceMode | null; answers: unknown },
    now: Date,
    practice: boolean,
  ): Promise<FormRegistrationResult> => {
    const setup = await stores.registrations.setupOf(event.id);
    if (!setup) return { ok: false, error: "invalid" };
    try {
      assertAttendanceMode(setup, input.attendanceMode);
    } catch {
      return { ok: false, error: "mode" };
    }
    const token = await stores.forms.tokenOf(setup.formId);
    if (token === null) return { ok: false, error: "closed" };

    if (practice) {
      const found = await stores.forms.findPublic(token, now, user);
      if (!found || found.state !== "open") return { ok: false, error: "closed" };
      if (found.version.number !== input.version) return { ok: false, error: "changed" };
      const parsed = parseAnswers(found.version.questions, input.answers);
      return parsed.ok
        ? { ok: true, status: "confirmed", practice: true }
        : { ok: false, error: "answers", fields: parsed.fields };
    }

    let registered: { status: RegistrationStatus; created: boolean } | null = null;
    try {
      const outcome = await stores.forms.submit(
        token,
        input.version,
        input.answers,
        now,
        { user },
        async (tx, saved) => {
          registered = await stores.registrations.registerIn(tx, event.id, user.uid, now, {
            attendanceMode: input.attendanceMode,
            responseId: saved.responseId,
            formVersion: saved.version,
          });
        },
      );
      if (!outcome.ok) {
        if (outcome.error === "answers")
          return { ok: false, error: "answers", fields: outcome.fields };
        if (outcome.error === "changed") return { ok: false, error: "changed" };
        return { ok: false, error: outcome.error === "signin" ? "signin" : "closed" };
      }
    } catch (error) {
      // Registration closed, or the form changed under us: nothing was written.
      if (error instanceof RuleViolationError) return { ok: false, error: "closed" };
      throw error;
    }
    const done = registered as { status: RegistrationStatus; created: boolean } | null;
    return done
      ? { ok: true, status: done.status, practice: false }
      : { ok: false, error: "closed" };
  };
}

const FormInput = z
  .object({
    slug: z.string().refine(isValidSlug),
    version: z.number().int().min(1),
    attendanceMode: z.enum(ATTENDANCE_MODES).nullable(),
    answers: z.record(z.string().max(40), z.unknown()),
    practice: z.boolean().optional(),
    token: z.string().max(4000),
  })
  .strict();

export interface FormRegistrationDeps extends Omit<RegistrationDeps, "register"> {
  readonly registerWithForm: ReturnType<typeof createFormRegistrationTransaction>;
}

export function createEventFormRegistration(deps: FormRegistrationDeps) {
  return async (
    user: Account | null,
    input: unknown,
    language: Language,
  ): Promise<FormRegistrationResult> => {
    if (!user) return { ok: false, error: "signin" };
    const parsed = FormInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!(await deps.captcha(parsed.data.token))) return { ok: false, error: "captcha" };
    if (!(await deps.profileComplete(user.uid))) return { ok: false, error: "profile" };
    const event = await deps.findEvent(parsed.data.slug);
    if (!event) return { ok: false, error: "closed" };
    const result = await deps.registerWithForm(
      event,
      user,
      parsed.data,
      deps.now(),
      parsed.data.practice === true,
    );
    // The confirmation goes once per person (its key); a repeated submit only updates the answers.
    if (result.ok && !result.practice) {
      await confirmByEmail(deps, event, user, result.status, language);
    }
    return result;
  };
}
