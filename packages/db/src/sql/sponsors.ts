import type { Database } from "./store";
import type { Snapshot } from "@website/audit";
import {
  sortSponsors,
  toPublicSponsor,
  type DirectorySponsor,
  type PublicSponsor,
  type SponsorTier,
} from "@website/domain/organizations";
import type { FeaturedImage } from "@website/domain/content";
import { createSluggedStore, toDate } from "./slugged";

export type DirectorySponsorFields = Omit<
  DirectorySponsor,
  "id" | "version" | "createdAt" | "updatedAt"
>;

function toSponsor(id: string, data: Record<string, unknown>): DirectorySponsor {
  return {
    id,
    name: data["name"] as string,
    tier: data["tier"] as SponsorTier,
    logo: (data["logo"] as FeaturedImage | null | undefined) ?? null,
    link: (data["link"] as string | null | undefined) ?? null,
    periodId: data["periodId"] as string,
    order: (data["order"] as number | undefined) ?? 0,
    published: data["published"] as boolean,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function sponsorSnapshot(s: DirectorySponsorFields): Snapshot {
  return {
    name: s.name,
    tier: s.tier,
    logo: s.logo ? { ...s.logo } : null,
    link: s.link,
    periodId: s.periodId,
    order: s.order,
    published: s.published,
  };
}

const sponsors = (db: Database) =>
  createSluggedStore<DirectorySponsor>(db, {
    collection: "sponsors",
    slug: null,
    fromDoc: toSponsor,
    snapshot: sponsorSnapshot,
    fixed: () => ({}),
  });

/** The board period everything of the directory belongs to: the active one. */
async function activePeriod(db: Database) {
  const active = await db.collection("settings").doc("activePeriod").get();
  const id = active.get("periodId") as string | undefined;
  if (!id) return null;
  const period = await db.collection("periods").doc(id).get();
  return period.exists
    ? {
        id,
        startsOn: period.get("startsOn") as string,
        endsOn: period.get("endsOn") as string,
      }
    : { id, startsOn: null, endsOn: null };
}

export function createSqlSponsorStore(db: Database) {
  const store = sponsors(db);
  return {
    /** The sponsors of the active period, in directory order. */
    async listForAdmin(limit = 500): Promise<DirectorySponsor[]> {
      const period = await activePeriod(db);
      if (!period) return [];
      const snapshot = await store.docs.where("periodId", "==", period.id).limit(limit).get();
      return sortSponsors(
        snapshot.docs
          .map((doc) => store.read(doc.id, doc.data()))
          .filter((s) => s.deletedAt === null),
      );
    },
    async activePeriodId(): Promise<string | null> {
      return (await activePeriod(db))?.id ?? null;
    },
    get: store.get,
    write: store.write,
  };
}
export type SqlSponsorStore = ReturnType<typeof createSqlSponsorStore>;

export function createSqlSponsorReader(db: Database) {
  const store = sponsors(db);
  return {
    /** Published sponsors of the active period, and the period's dates for the reach table. */
    async directory(limit = 500): Promise<{
      sponsors: PublicSponsor[];
      period: { startsOn: string; endsOn: string } | null;
    }> {
      const period = await activePeriod(db);
      if (!period) return { sponsors: [], period: null };
      const snapshot = await store.docs
        .where("periodId", "==", period.id)
        .where("published", "==", true)
        .limit(limit)
        .get();
      return {
        sponsors: sortSponsors(
          snapshot.docs
            .map((doc) => store.read(doc.id, doc.data()))
            .filter((s) => s.deletedAt === null),
        ).map(toPublicSponsor),
        period:
          period.startsOn && period.endsOn
            ? { startsOn: period.startsOn, endsOn: period.endsOn }
            : null,
      };
    },
  };
}
export type SqlSponsorReader = ReturnType<typeof createSqlSponsorReader>;
