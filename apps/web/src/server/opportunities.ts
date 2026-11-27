import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlOpportunityReader } from "@website/db/sql";
import {
  boardOf,
  canApply,
  opportunityPhase,
  type Opportunity,
  type PublicOpportunity,
  toPublicOpportunity,
} from "@website/domain/opportunities";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlOpportunityReader(webDb()));

export const today = () => new Date().toISOString().slice(0, 10);

/** Every posting that is not deleted; the board and the archive cut it by their own rule. */
async function allPostings(): Promise<Opportunity[]> {
  "use cache";
  cacheTag("opportunities");
  cacheLife("minutes");
  return reader().all();
}

/** What the board (open and greyed postings) or the archive (closed ones) lists. */
export async function opportunitiesFor(list: "board" | "archive"): Promise<PublicOpportunity[]> {
  const day = today();
  return boardOf(await allPostings(), day, list).map((o) => toPublicOpportunity(o, day));
}

/**
 * The link of a posting that may still be applied to, after counting the click; null when it is
 * gone, closed, past its deadline or applied for on the platform. Only https links are returned.
 */
export async function applyLink(id: string): Promise<string | null> {
  const posting = await reader().get(id);
  if (!posting || posting.deletedAt !== null) return null;
  if (!canApply(opportunityPhase(posting, today()))) return null;
  if (!posting.applyUrl || !/^https:\/\//i.test(posting.applyUrl)) return null;
  await reader().countClick(id);
  return posting.applyUrl;
}
