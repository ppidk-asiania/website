import "server-only";
import { z } from "zod";
import type { SqlEventStore, SqlFormStore, SqlRegistrationStore } from "@website/db/sql";
import {
  EventRegistrationSetupSchema,
  type EventEntity,
  type RegistrationStatus,
} from "@website/domain/events";
import { answerColumns, answerText, type FormResponse } from "@website/domain/forms";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { eventAudit } from "./events";
import { createGuardedAction } from "./guarded-action";

export interface EventRegistrationDeps {
  readonly events: Pick<SqlEventStore, "get" | "write">;
  readonly forms: Pick<SqlFormStore, "get" | "listResponses" | "listVersions">;
  readonly registrations: Pick<SqlRegistrationStore, "listForEvent">;
  readonly users: (
    uids: readonly string[],
  ) => Promise<ReadonlyMap<string, { name: string | null; email: string | null }>>;
  /** Silent mode of the links module: returns the long URL again when no provider answers. */
  readonly shorten: (longUrl: string, title: string) => Promise<string>;
  readonly webUrl: string;
  readonly now: () => Date;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
const MAX_RESPONSES = 5000;

export interface RegistrantRow {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly status: RegistrationStatus;
  readonly attendanceMode: string | null;
  readonly registeredAt: string;
  /** One text per column, in the order of `columns`. */
  readonly answers: readonly string[];
}

export function createEventRegistrationActions(deps: EventRegistrationDeps) {
  const save = createGuardedAction({
    permission: "events.edit",
    input: Ref.extend({
      // null removes the form: the event goes back to one-click registration
      setup: EventRegistrationSetupSchema.nullable(),
    }).strict(),
    handler: async ({ id, version, setup }, _principal, audit) => {
      if (setup) {
        const form = await deps.forms.get(setup.formId);
        if (!form || form.deletedAt !== null || form.usage !== "public") {
          throw new RuleViolationError("This form does not exist.");
        }
        if (form.respondents !== "account") {
          throw new RuleViolationError("Choose a form that is answered with an account.");
        }
      }
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          return {
            ...event,
            registration: setup && { ...setup, shortUrl: event.registration?.shortUrl ?? null },
          };
        },
        eventAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  // Made once and reused: a second request returns the link that exists.
  const shortLink = createGuardedAction({
    permission: "events.edit",
    input: Ref,
    handler: async ({ id, version }, _principal, audit) => {
      const event = await deps.events.get(id);
      if (!event?.registration) throw new RuleViolationError("Choose the registration form first.");
      if (event.registration.shortUrl) {
        return { shortUrl: event.registration.shortUrl, version: event.version };
      }
      const longUrl = `${deps.webUrl}/events/${event.slug}/register`;
      const shortUrl = await deps.shorten(longUrl, `Registration: ${event.title}`);
      if (shortUrl === longUrl) {
        throw new RuleViolationError("The short link service did not answer. Try again later.");
      }
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const next = current as EventEntity;
          return { ...next, registration: { ...next.registration!, shortUrl } };
        },
        eventAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { shortUrl, version: saved.version };
    },
  });

  const registrants = createGuardedAction({
    permission: "registrants.read",
    input: z.object({ eventId: safeId }).strict(),
    handler: async ({ eventId }) => {
      const event = await deps.events.get(eventId);
      if (!event || event.deletedAt !== null)
        throw new RuleViolationError("This event does not exist.");
      const rows = await deps.registrations.listForEvent(eventId);
      const formId = event.registration?.formId ?? null;
      const [versions, responses, users] = await Promise.all([
        formId ? deps.forms.listVersions(formId) : [],
        formId ? deps.forms.listResponses(formId, MAX_RESPONSES) : [],
        deps.users(rows.map((r) => r.userId)),
      ]);
      const columns = answerColumns(versions);
      const byUser = new Map<string, FormResponse>(
        responses.flatMap((r) => (r.uid ? [[r.uid, r] as const] : [])),
      );
      return {
        columns: [...columns.values()],
        rows: rows.map((r): RegistrantRow => ({
          userId: r.userId,
          name: users.get(r.userId)?.name ?? "",
          email: users.get(r.userId)?.email ?? "",
          status: r.status,
          attendanceMode: r.attendanceMode,
          registeredAt: r.registeredAt.toISOString(),
          answers: [...columns.keys()].map((q) => answerText(byUser.get(r.userId)?.answers[q])),
        })),
      };
    },
  });

  return { save, shortLink, registrants };
}
