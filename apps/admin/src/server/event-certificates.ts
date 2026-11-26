import "server-only";
import { z } from "zod";
import type {
  SqlCertificateStore,
  SqlCommitteeStore,
  SqlEventStore,
  SqlFormStore,
  SqlRegistrationStore,
} from "@website/db/sql";
import type { Letter } from "@website/domain/documents";
import {
  DEFAULT_EVALUATION,
  entitledToCertificate,
  type CertificateGap,
} from "@website/domain/events";
import { isSignedInMode } from "@website/domain/forms";
import { RuleViolationError } from "@website/domain/shared";
import { can, type ResourceContext } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { participantAudit } from "./certificates";
import { createGuardedAction } from "./guarded-action";

export type LeftOut = CertificateGap | "no_name" | "already_on_batch";

export interface EventCertificateDeps {
  readonly certificates: Pick<SqlCertificateStore, "add" | "list">;
  readonly getLetter: (id: string) => Promise<Letter | null>;
  readonly hashEmail: (email: string) => string;
  readonly events: Pick<SqlEventStore, "get">;
  readonly registrations: Pick<SqlRegistrationStore, "listForEvent">;
  readonly committees: Pick<SqlCommitteeStore, "get">;
  readonly forms: Pick<SqlFormStore, "get" | "listResponses">;
  readonly users: (
    uids: readonly string[],
  ) => Promise<ReadonlyMap<string, { name: string | null; email: string | null }>>;
  readonly now: () => Date;
}

const MAX_ANSWERS = 5000;

/** "Add registrants" of a certificate batch (N1.7): the people of an event who earned a certificate. */
export function createEventCertificateActions(deps: EventCertificateDeps) {
  const addFromEvent = createGuardedAction({
    permission: "letters.edit",
    input: z.object({ batchId: safeId, eventId: safeId }).strict(),
    resource: async ({ batchId }): Promise<ResourceContext> => ({
      orgUnitPath: (await deps.getLetter(batchId))?.orgUnitPath ?? [],
    }),
    handler: async ({ batchId, eventId }, principal, audit) => {
      // The list holds names and e-mails of registrants, so the event's own rights are needed too.
      if (!can(principal, "events.edit") && !can(principal, "registrants.read")) {
        throw new RuleViolationError("You need access to the registrants of this event.");
      }
      const event = await deps.events.get(eventId);
      if (!event || event.deletedAt !== null)
        throw new RuleViolationError("This event does not exist.");
      const settings = (await deps.committees.get(eventId))?.evaluation ?? DEFAULT_EVALUATION;
      // Only an evaluation answered with an account can be a condition: nobody knows who answered otherwise.
      const form = settings.formId ? await deps.forms.get(settings.formId) : null;
      const needsEvaluation = !!form && form.deletedAt === null && isSignedInMode(form.respondents);
      const evaluated = new Set(
        needsEvaluation && settings.formId
          ? (await deps.forms.listResponses(settings.formId, MAX_ANSWERS)).flatMap((r) =>
              r.uid ? [r.uid] : [],
            )
          : [],
      );
      const rows = await deps.registrations.listForEvent(eventId);
      const [accounts, already] = await Promise.all([
        deps.users(rows.map((r) => r.userId)),
        deps.certificates.list(batchId),
      ]);
      const onBatch = new Set(already.flatMap((c) => (c.emailHash ? [c.emailHash] : [])));
      const people: Array<{ name: string; note: string | null; emailHash: string | null }> = [];
      const leftOut: Array<{ name: string; reason: LeftOut }> = [];
      for (const row of rows) {
        const account = accounts.get(row.userId);
        const shown = account?.name ?? account?.email ?? "(unknown account)";
        const verdict = entitledToCertificate(
          { status: row.status, checkedIn: row.checkedInAt !== null },
          { needsAttendance: settings.certificateNeedsAttendance, needsEvaluation },
          evaluated.has(row.userId),
        );
        if (!verdict.entitled) {
          // A person who cancelled is not "left out": they never took part.
          if (row.status !== "cancelled") leftOut.push({ name: shown, reason: verdict.reason });
          continue;
        }
        const emailHash = account?.email ? deps.hashEmail(account.email) : null;
        if (!account?.name) leftOut.push({ name: shown, reason: "no_name" });
        else if (emailHash && onBatch.has(emailHash))
          leftOut.push({ name: shown, reason: "already_on_batch" });
        else people.push({ name: account.name, note: null, emailHash });
      }
      const added =
        people.length === 0
          ? 0
          : await deps.certificates.add(batchId, people, participantAudit(audit), deps.now());
      return { added, leftOut };
    },
  });

  return { addFromEvent };
}
