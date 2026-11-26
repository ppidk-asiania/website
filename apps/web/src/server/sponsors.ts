import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlSponsorReader } from "@website/db/sql";
import { reachRows, type PublicSponsor, type ReachRow } from "@website/domain/organizations";
import { publicEvents } from "./events";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlSponsorReader(webDb()));

/** Published sponsors of the active period, sorted by tier: the home strip and /sponsorship share this. */
export async function publicSponsors(): Promise<{
  sponsors: PublicSponsor[];
  period: { startsOn: string; endsOn: string } | null;
}> {
  "use cache";
  cacheTag("sponsors");
  cacheLife("minutes");
  return reader().directory();
}

export async function sponsorshipReach(
  period: { startsOn: string; endsOn: string } | null,
): Promise<ReachRow[]> {
  return period ? reachRows(await publicEvents(), period, new Date()) : [];
}
