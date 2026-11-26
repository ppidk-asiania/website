import "server-only";
import { z } from "zod";
import type {
  PaymentCashAudit,
  SqlEventStore,
  SqlFormStore,
  SqlRegistrationStore,
} from "@website/db/sql";
import {
  EventFeeInputSchema,
  EventRegistrationSetupSchema,
  feeAmount,
  registrationId,
  type CommitteeRole,
  type EventEntity,
  type PaymentState,
  type RegistrationStatus,
} from "@website/domain/events";
import { answerColumns, answerText, type FormResponse } from "@website/domain/forms";
import { formatMoney, RuleViolationError } from "@website/domain/shared";
import { can, type Principal } from "@website/permissions";
import { jsonError } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { eventAudit } from "./events";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface EventRegistrationDeps {
  readonly events: Pick<SqlEventStore, "get" | "write">;
  readonly forms: Pick<SqlFormStore, "get" | "listResponses" | "listVersions">;
  readonly registrations: Pick<
    SqlRegistrationStore,
    "listForEvent" | "verifyPayment" | "rejectPayment" | "proofOf"
  >;
  /** A private file link, short-lived (the proof of a payment). */
  readonly storage: { signedReadUrl(path: string): Promise<string> };
  readonly notify: {
    paymentDecided(
      event: EventEntity,
      uid: string,
      verified: boolean,
      note: string | null,
      at: Date,
    ): Promise<void>;
  };
  readonly uuid: () => string;
  readonly users: (
    uids: readonly string[],
  ) => Promise<ReadonlyMap<string, { name: string | null; email: string | null }>>;
  /** Silent mode of the links module: returns the long URL again when no provider answers. */
  readonly shorten: (longUrl: string, title: string) => Promise<string>;
  readonly webUrl: string;
  /** The seat of an account on this event now (N1.5). */
  readonly committeeRole: (userId: string, eventId: string) => Promise<CommitteeRole | null>;
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
  readonly registrationId: string;
  readonly payment: PaymentState;
  /** Ticket category name and amount to pay (or paid), empty for a free event. */
  readonly category: string;
  readonly amount: string;
  readonly hasProof: boolean;
  readonly paymentNote: string | null;
}

const noStore = { "Cache-Control": "no-store" };

const paymentAudit =
  (audit: AuditBuilder, id: string) =>
  (before: Parameters<AuditBuilder>[0]["before"], after: Parameters<AuditBuilder>[0]["after"]) =>
    audit({
      module: "events",
      action: "UPDATE",
      resourceType: "eventRegistration",
      resourceId: id,
      title: "Payment check",
      before,
      after,
      versionBefore: null,
      versionAfter: null,
      revertible: false,
    });

const cashAudit =
  (audit: AuditBuilder): PaymentCashAudit =>
  (after, entry) =>
    audit({
      module: "finance",
      action: "CREATE",
      resourceType: "cashEntry",
      resourceId: entry.id,
      title: `${entry.description} (${formatMoney(entry)})`,
      before: null,
      after,
      versionBefore: null,
      versionAfter: 1,
      revertible: false,
    });

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
          if (!setup && event.fee?.paid) {
            throw new RuleViolationError(
              "A paid event needs its registration form. Turn the fee off first.",
            );
          }
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
    // Whoever checks payments needs to see who paid; the committee sees the event's own people (N1.5).
    orIf: async (principal: Principal, { eventId }) =>
      can(principal, "events.payments") ||
      (await deps.committeeRole(principal.userId, eventId)) !== null,
    input: z.object({ eventId: safeId }).strict(),
    handler: async ({ eventId }, principal) => {
      const event = await deps.events.get(eventId);
      if (!event || event.deletedAt !== null)
        throw new RuleViolationError("This event does not exist.");
      const rows = await deps.registrations.listForEvent(eventId);
      const full =
        can(principal, "registrants.read") ||
        can(principal, "events.payments") ||
        (await deps.committeeRole(principal.userId, eventId)) === "board";
      if (!full) {
        // The short list is cut here: no e-mail, answers, payment or proof ever leaves the server.
        const people = await deps.users(rows.map((r) => r.userId));
        return {
          columns: [],
          rows: rows
            .filter((r) => r.status !== "cancelled")
            .map((r): RegistrantRow => ({
              userId: r.userId,
              name: people.get(r.userId)?.name ?? "",
              email: "",
              status: r.status,
              attendanceMode: r.attendanceMode,
              registeredAt: r.registeredAt.toISOString(),
              answers: [],
              registrationId: registrationId(eventId, r.userId),
              payment: "not_required",
              category: event.fee?.categories.find((c) => c.id === r.feeCategory)?.label ?? "",
              amount: "",
              hasProof: false,
              paymentNote: null,
            })),
        };
      }
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
          registrationId: registrationId(eventId, r.userId),
          payment: r.payment,
          category: event.fee?.categories.find((c) => c.id === r.feeCategory)?.label ?? "",
          amount:
            event.fee && r.feeCategory
              ? formatMoney({
                  amountMinor: r.amountMinor ?? feeAmount(event.fee, r.feeCategory, r.registeredAt),
                  currency: event.fee.currency,
                })
              : "",
          hasProof: r.hasProof,
          paymentNote: r.paymentNote,
        })),
      };
    },
  });

  const saveFee = createGuardedAction({
    permission: "events.edit",
    input: Ref.extend({ fee: EventFeeInputSchema.nullable() }).strict(),
    handler: async ({ id, version, fee }, _principal, audit) => {
      const people = await deps.registrations.listForEvent(id);
      const kept = new Set(fee?.categories.map((c) => c.id));
      if (people.some((r) => r.feeCategory !== null && !kept.has(r.feeCategory))) {
        throw new RuleViolationError("A category that people registered for cannot be removed.");
      }
      if (
        !fee?.paid &&
        people.some(
          (r) => r.payment === "unpaid" || r.payment === "submitted" || r.payment === "rejected",
        )
      ) {
        throw new RuleViolationError(
          "Some people still have to pay or wait for a check. Settle them first.",
        );
      }
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          if (fee?.paid && !event.registration) {
            throw new RuleViolationError(
              "A paid event registers on its form page: choose the registration form first.",
            );
          }
          return {
            ...event,
            fee: fee && {
              ...fee,
              categories: fee.categories.map((c) => ({
                ...c,
                id: c.id || deps.uuid().replace(/-/g, "").slice(0, 10),
              })),
            },
          };
        },
        eventAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  const Registration = z.object({ registrationId: safeId }).strict();

  const verify = createGuardedAction({
    permission: "events.payments",
    input: Registration,
    handler: async ({ registrationId: id }, principal, audit) => {
      const now = deps.now();
      const done = await deps.registrations.verifyPayment(
        id,
        principal.userId,
        now,
        paymentAudit(audit, id),
        cashAudit(audit),
      );
      const event = done.changed ? await deps.events.get(done.eventId) : null;
      if (event) await deps.notify.paymentDecided(event, done.userId, true, null, now);
      return { changed: done.changed };
    },
  });

  const reject = createGuardedAction({
    permission: "events.payments",
    input: Registration.extend({
      note: safeText(500, { multiline: true }).pipe(
        z.string().min(3, "Write a short reason (at least 3 characters)."),
      ),
    }).strict(),
    handler: async ({ registrationId: id, note }, principal, audit) => {
      const now = deps.now();
      const done = await deps.registrations.rejectPayment(
        id,
        principal.userId,
        note,
        now,
        paymentAudit(audit, id),
      );
      const event = await deps.events.get(done.eventId);
      if (event) await deps.notify.paymentDecided(event, done.userId, false, note, now);
      return { changed: true };
    },
  });

  /** The checker opens the proof: a short-lived link to the private file. */
  const openProof = async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!can(principal, "events.payments")) return jsonError("forbidden");
    const proof = safeId.safeParse(id).success ? await deps.registrations.proofOf(id) : null;
    if (!proof) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    return new Response(null, {
      status: 302,
      headers: { Location: await deps.storage.signedReadUrl(proof.path), ...noStore },
    });
  };

  return { save, shortLink, registrants, saveFee, verify, reject, openProof };
}
