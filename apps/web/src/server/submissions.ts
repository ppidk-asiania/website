import "server-only";
import type { SqlLoanWebStore, SqlRegistrationStore, SqlSubmissionReader } from "@website/db/sql";
import { formatMoney } from "@website/domain/shared";

export type SubmissionKind = "event" | "recruitment" | "form" | "opportunity" | "loan" | "donation";

/** One thing the account sent. `state` is a code the page turns into text (by kind), in its language. */
export interface Submission {
  readonly kind: SubmissionKind;
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly at: Date;
  readonly href: string | null;
  /** Recruitment: the key of what the applicant does next. */
  readonly next?: string;
  /** Donations: the amount. */
  readonly detail?: string;
  /** Events: the ticket page, once there is something to show (a fee, or a confirmed seat). */
  readonly ticketHref?: string;
}

export interface SubmissionDeps {
  readonly events: Pick<SqlRegistrationStore, "listByUser">;
  readonly loans: Pick<SqlLoanWebStore, "mine">;
  readonly rows: Pick<
    SqlSubmissionReader,
    "recruitment" | "formAnswers" | "opportunities" | "donations"
  >;
  readonly now: () => Date;
}

/**
 * Everything one account has sent, newest first. The only input is the session's uid: no parameter
 * can ask for another person's list. Each module contributes one reader below.
 */
export function createSubmissions(deps: SubmissionDeps) {
  return async function submissionsOf(uid: string): Promise<Submission[]> {
    const now = deps.now();
    const [events, loans, recruitment, forms, opportunities, donations] = await Promise.all([
      deps.events.listByUser(uid),
      deps.loans.mine(uid),
      deps.rows.recruitment(uid, now),
      deps.rows.formAnswers(uid),
      deps.rows.opportunities(uid),
      deps.rows.donations(uid),
    ]);
    const all: Submission[] = [
      ...events.map(({ event, status }) => ({
        kind: "event" as const,
        id: event.id,
        title: event.title,
        state: status,
        at: event.startsAt,
        href: `/events/${event.slug}`,
        ...(event.fee || status === "confirmed"
          ? { ticketHref: `/events/${event.slug}/ticket` }
          : {}),
      })),
      ...recruitment.map((r) => ({
        kind: "recruitment" as const,
        ...r,
        href: `/recruitment/${r.id}`,
      })),
      ...forms.map((r) => ({ kind: "form" as const, ...r, href: null })),
      ...opportunities.map((r) => ({
        kind: "opportunity" as const,
        ...r,
        href: "/opportunities",
      })),
      ...loans.map((l) => ({
        kind: "loan" as const,
        id: l.id,
        title: l.itemName,
        state: l.status,
        at: l.createdAt,
        href: "/inventory",
      })),
      ...donations.map(({ amountMinor, currency, ...r }) => ({
        kind: "donation" as const,
        ...r,
        detail: formatMoney({ amountMinor, currency }),
        href: null,
      })),
    ];
    return all.sort((a, b) => b.at.getTime() - a.at.getTime());
  };
}
