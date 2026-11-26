import { z } from "zod";
import { safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import type { PublicEvent } from "../events";
import { isPast } from "../events/lifecycle";
import type { EntityMeta } from "../shared";
import { LinkSchema } from "./documents";

/** The directory of sponsors of a board period (N5.3): shown on the home page and /sponsorship. */
export const SPONSOR_TIERS = ["platinum", "gold", "silver", "partner"] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];

export interface DirectorySponsor extends EntityMeta {
  readonly name: string;
  readonly tier: SponsorTier;
  readonly logo: FeaturedImage | null;
  readonly link: string | null;
  /** The board period it belongs to: taken from the active period when it is added. */
  readonly periodId: string;
  /** Position inside the tier, smallest first. */
  readonly order: number;
  readonly published: boolean;
}

export const DirectorySponsorInputSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(2, "Enter the sponsor's name.")),
    tier: z.enum(SPONSOR_TIERS, { error: "Choose a tier." }),
    logo: FeaturedImageSchema.nullable(),
    link: LinkSchema,
    order: z.number().int().min(0).max(999),
    published: z.boolean(),
  })
  .strict();
export type DirectorySponsorInput = z.infer<typeof DirectorySponsorInputSchema>;

export interface PublicSponsor {
  readonly id: string;
  readonly name: string;
  readonly tier: SponsorTier;
  readonly logo: FeaturedImage | null;
  readonly link: string | null;
}

export const toPublicSponsor = (s: DirectorySponsor): PublicSponsor => ({
  id: s.id,
  name: s.name,
  tier: s.tier,
  logo: s.logo,
  link: s.link,
});

/** Tier order first (platinum to partner), then the position, then the name. */
export function sortSponsors<T extends Pick<PublicSponsor, "tier" | "name"> & { order?: number }>(
  sponsors: readonly T[],
): T[] {
  return [...sponsors].sort(
    (a, b) =>
      SPONSOR_TIERS.indexOf(a.tier) - SPONSOR_TIERS.indexOf(b.tier) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

export function groupByTier(
  sponsors: readonly PublicSponsor[],
): Array<{ tier: SponsorTier; sponsors: PublicSponsor[] }> {
  return SPONSOR_TIERS.flatMap((tier) => {
    const mine = sponsors.filter((s) => s.tier === tier);
    return mine.length > 0 ? [{ tier, sponsors: mine }] : [];
  });
}

export interface ReachRow {
  readonly slug: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly timezone: string;
  /** `finalAttendance` once the organisers entered it; null until then. */
  readonly attendance: number | null;
}

/** Events of the period that are over and were not cancelled, newest first (the numbers sponsors care about). */
export function reachRows(
  events: readonly PublicEvent[],
  period: { readonly startsOn: string; readonly endsOn: string },
  now: Date,
): ReachRow[] {
  const from = new Date(`${period.startsOn}T00:00:00Z`);
  const to = new Date(`${period.endsOn}T23:59:59.999Z`);
  return events
    .filter(
      (e) => e.cancelledAt === null && isPast(e, now) && e.startsAt >= from && e.startsAt <= to,
    )
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .map((e) => ({
      slug: e.slug,
      title: e.title,
      startsAt: e.startsAt,
      timezone: e.timezone,
      attendance: e.finalAttendance,
    }));
}
