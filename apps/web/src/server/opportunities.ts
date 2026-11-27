import "server-only";
import { randomUUID } from "node:crypto";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  createSqlFormWebStore,
  createSqlOpportunityApplicationWebStore,
  createSqlOpportunityReader,
} from "@website/db/sql";
import {
  boardOf,
  canApply,
  opportunityPhase,
  type Opportunity,
  type PublicOpportunity,
  toPublicOpportunity,
} from "@website/domain/opportunities";
import { webDb, webStorage } from "./db";
import { messenger } from "./messaging";
import { createOpportunityApplications } from "./opportunity-applications";
import { hasCompleteProfile } from "./profile-wiring";

const reader = lazyEnv(() => createSqlOpportunityReader(webDb()));
const applications = lazyEnv(() => createSqlOpportunityApplicationWebStore(webDb()));

/** An application made on the platform: cover letter and CV (PDF). */
export const applying = lazyEnv(() =>
  createOpportunityApplications({
    applications: applications(),
    storage: webStorage(),
    send: (message, key) => messenger().send(message, key),
    profileComplete: hasCompleteProfile,
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

/** The postings this account already applied to, with the status of each (never the staff note). */
export async function appliedStatuses(userId: string): Promise<Map<string, string>> {
  return new Map((await applications().mine(userId)).map((a) => [a.opportunityId, a.status]));
}

/** `/f/{token}` of the mentorship form chosen in the admin, or null when none is chosen. */
export async function mentorshipLink(): Promise<string | null> {
  const formId = await reader().mentorshipFormId();
  const token = formId && (await createSqlFormWebStore(webDb()).tokenOf(formId));
  return token ? `/f/${token}` : null;
}

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
