import type { AuditEvent, Snapshot } from "@website/audit";
import type { FeaturedImage } from "@website/domain/content";
import type {
  Opportunity,
  OpportunityStatus,
  OpportunityType,
} from "@website/domain/opportunities";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { createSluggedStore, toDate } from "./slugged";
import type { Database } from "./store";

export type OpportunityFields = Omit<Opportunity, "id" | "version" | "createdAt" | "updatedAt">;

export function toOpportunity(id: string, data: Record<string, unknown>): Opportunity {
  return {
    id,
    title: data["title"] as string,
    organization: data["organization"] as string,
    country: data["country"] as string,
    city: (data["city"] as string | undefined) ?? "",
    type: data["type"] as OpportunityType,
    description: (data["description"] as string | undefined) ?? "",
    requirements: (data["requirements"] as string | undefined) ?? "",
    deadline: (data["deadline"] as string | null | undefined) ?? null,
    applyUrl: (data["applyUrl"] as string | null | undefined) ?? null,
    image: (data["image"] as FeaturedImage | null | undefined) ?? null,
    status: data["status"] as OpportunityStatus,
    chapterId: (data["chapterId"] as string | null | undefined) ?? null,
    postedBy: data["postedBy"] as string,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

/** What an audit entry keeps: the short fields; the long texts stay out of the log. */
export function opportunitySnapshot(o: OpportunityFields): Snapshot {
  return {
    title: o.title,
    organization: o.organization,
    country: o.country,
    city: o.city,
    type: o.type,
    deadline: o.deadline,
    applyUrl: o.applyUrl,
    image: o.image ? { ...o.image } : null,
    status: o.status,
    chapterId: o.chapterId,
  };
}

const opportunities = (db: Database) =>
  createSluggedStore<Opportunity>(db, {
    collection: "opportunities",
    slug: null,
    fromDoc: toOpportunity,
    snapshot: opportunitySnapshot,
    fixed: (o) => ({
      description: o.description,
      requirements: o.requirements,
      postedBy: o.postedBy,
    }),
  });

const MAX_LIST = 1000;

/** The account form people fill in to sign up for mentorship (one setting, no store of its own). */
const mentorshipFormOf = async (db: Database): Promise<string | null> =>
  ((await db.collection("settings").doc("opportunities").get()).get("mentorshipFormId") as
    string | null | undefined) ?? null;

/** Admin side: every posting that is not deleted, newest first, and the click counts. */
export function createSqlOpportunityStore(db: Database) {
  const store = opportunities(db);
  const clicks = db.collection("opportunityClicks");
  return {
    async listForAdmin(limit = MAX_LIST): Promise<Opportunity[]> {
      const snapshot = await store.docs.limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((o) => o.deletedAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    /** Clicks per posting id; a posting nobody clicked has no row. */
    async clickCounts(ids: readonly string[]): Promise<Map<string, number>> {
      const rows = await Promise.all(ids.map((id) => clicks.doc(safeId.parse(id)).get()));
      return new Map(
        rows.flatMap((row, i) =>
          row.exists ? [[ids[i] as string, row.get("count") as number]] : [],
        ),
      );
    },
    mentorshipFormId: () => mentorshipFormOf(db),
    /** Choose (or clear) the mentorship form, with one audit entry in the same transaction. */
    async setMentorshipForm(
      formId: string | null,
      auditFor: (before: Snapshot, after: Snapshot) => AuditEvent,
    ): Promise<void> {
      const ref = db.collection("settings").doc("opportunities");
      const audit = createSqlAuditWriter(db);
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).get("mentorshipFormId") as string | null | undefined;
        const log = await audit.begin(tx);
        tx.set(ref, { mentorshipFormId: formId });
        log.append(auditFor({ mentorshipFormId: current ?? null }, { mentorshipFormId: formId }));
      });
    },
    get: store.get,
    write: store.write,
  };
}
export type SqlOpportunityStore = ReturnType<typeof createSqlOpportunityStore>;

/** Public side: the postings the board lists, and the click that goes with "apply". */
export function createSqlOpportunityReader(db: Database) {
  const store = opportunities(db);
  const clicks = db.collection("opportunityClicks");
  return {
    async all(limit = MAX_LIST): Promise<Opportunity[]> {
      const snapshot = await store.docs.limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((o) => o.deletedAt === null);
    },
    get: store.get,
    mentorshipFormId: () => mentorshipFormOf(db),
    /** One more click on a posting. Nothing about the person is stored. */
    async countClick(id: string): Promise<void> {
      const ref = clicks.doc(safeId.parse(id));
      await db.runTransaction(async (tx) => {
        const row = await tx.get(ref);
        tx.set(ref, { count: ((row.exists ? row.get("count") : 0) as number) + 1 });
      });
    },
  };
}
export type SqlOpportunityReader = ReturnType<typeof createSqlOpportunityReader>;
