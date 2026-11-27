import type { DonationState } from "@website/domain/organizations";
import type { Money } from "@website/domain/shared";
import { nextAction, type NextAction, type Recruitment } from "@website/domain/recruitment";
import type { ApplicationStatus as OpportunityStatus } from "@website/domain/opportunities";
import { getDocumentsByIds } from "./batch";
import { toRecruitment, toApplication } from "./recruitment";
import { toDate } from "./slugged";
import type { Database } from "./store";

const LIMIT = 200;

/** One row of "My submissions" coming from a table of its own (the others have readers already). */
export interface SubmissionRow {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly at: Date;
  /** Recruitment only: what the applicant does next (a key of the recruitment dictionary). */
  readonly next?: NextAction;
}

/** What one account sent through recruitment, forms, opportunities and donations; never anyone else's. */
export function createSqlSubmissionReader(db: Database) {
  const titles = async (collection: string, ids: string[], field: string) => {
    const found = await getDocumentsByIds<Record<string, unknown>>(db, collection, ids);
    return (id: string) => (found.get(id)?.[field] as string | undefined) ?? "";
  };
  return {
    async recruitment(uid: string, now: Date): Promise<SubmissionRow[]> {
      const snapshot = await db
        .collection("applications")
        .where("userId", "==", uid)
        .limit(LIMIT)
        .get();
      const rows = snapshot.docs.map((d) =>
        toApplication(d.id, d.data() as Record<string, unknown>),
      );
      const found = await getDocumentsByIds<Record<string, unknown>>(
        db,
        "recruitments",
        rows.map((a) => a.recruitmentId),
      );
      return rows.flatMap((a) => {
        const data = found.get(a.recruitmentId);
        const recruitment: Recruitment | null = data ? toRecruitment(a.recruitmentId, data) : null;
        return recruitment
          ? [
              {
                id: a.recruitmentId,
                title: recruitment.title,
                state: a.status,
                at: a.submittedAt ?? a.createdAt,
                next: nextAction(recruitment, a, now),
              },
            ]
          : [];
      });
    },

    /** Answers to forms that need an account (committee applications, mentorship, polls ...). */
    async formAnswers(uid: string): Promise<SubmissionRow[]> {
      const snapshot = await db
        .collection("formResponses")
        .where("uid", "==", uid)
        .limit(LIMIT)
        .get();
      const rows = snapshot.docs.map((d) => ({
        formId: d.get("formId") as string,
        at: toDate(d.get("updatedAt") ?? d.get("submittedAt")) as Date,
      }));
      const title = await titles(
        "forms",
        rows.map((r) => r.formId),
        "title",
      );
      return rows.map((r) => ({ id: r.formId, title: title(r.formId), state: "sent", at: r.at }));
    },

    async opportunities(uid: string): Promise<SubmissionRow[]> {
      const snapshot = await db
        .collection("opportunityApplications")
        .where("userId", "==", uid)
        .limit(LIMIT)
        .get();
      const rows = snapshot.docs.map((d) => ({
        opportunityId: d.get("opportunityId") as string,
        status: d.get("status") as OpportunityStatus,
        at: toDate(d.get("createdAt")) as Date,
      }));
      const title = await titles(
        "opportunities",
        rows.map((r) => r.opportunityId),
        "title",
      );
      return rows.map((r) => ({
        id: r.opportunityId,
        title: title(r.opportunityId),
        state: r.status,
        at: r.at,
      }));
    },

    async donations(uid: string): Promise<(SubmissionRow & Money)[]> {
      const snapshot = await db
        .collection("donations")
        .where("userId", "==", uid)
        .limit(LIMIT)
        .get();
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        channelId: d.get("channelId") as string,
        amountMinor: d.get("amountMinor") as number,
        currency: d.get("currency") as Money["currency"],
        status: d.get("status") as DonationState,
        at: toDate(d.get("createdAt")) as Date,
      }));
      const label = await titles(
        "donationChannels",
        rows.map((r) => r.channelId),
        "label",
      );
      return rows.map((r) => ({
        id: r.id,
        title: label(r.channelId),
        state: r.status,
        at: r.at,
        amountMinor: r.amountMinor,
        currency: r.currency,
      }));
    },
  };
}
export type SqlSubmissionReader = ReturnType<typeof createSqlSubmissionReader>;
