import { describe, expect, it } from "vitest";
import {
  DirectorySponsorInputSchema,
  groupByTier,
  reachRows,
  sortSponsors,
  type PublicSponsor,
} from "@website/domain/organizations";
import type { PublicEvent } from "@website/domain/events";

const sponsor = (name: string, tier: PublicSponsor["tier"], order = 0) => ({
  id: name,
  name,
  tier,
  logo: null,
  link: null,
  order,
});

describe("sponsors directory (N5.3)", () => {
  it("sorts by tier, then position, then name", () => {
    const sorted = sortSponsors([
      sponsor("Zeta", "partner"),
      sponsor("Beta", "gold", 2),
      sponsor("Alpha", "gold", 2),
      sponsor("First", "gold", 1),
      sponsor("Top", "platinum"),
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Top", "First", "Alpha", "Beta", "Zeta"]);
  });

  it("groups by tier and leaves empty tiers out", () => {
    const groups = groupByTier([sponsor("A", "silver"), sponsor("B", "platinum")]);
    expect(groups.map((g) => g.tier)).toEqual(["platinum", "silver"]);
  });

  it("validates the form: name, tier and an https link", () => {
    const ok = { name: "Acme", tier: "gold", logo: null, link: "", order: 0, published: true };
    expect(DirectorySponsorInputSchema.safeParse(ok).success).toBe(true);
    expect(DirectorySponsorInputSchema.safeParse({ ...ok, name: "A" }).success).toBe(false);
    expect(DirectorySponsorInputSchema.safeParse({ ...ok, tier: "diamond" }).success).toBe(false);
    expect(
      DirectorySponsorInputSchema.safeParse({ ...ok, link: "http://plain.example" }).success,
    ).toBe(false);
    expect(DirectorySponsorInputSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("reach lists past, uncancelled events of the period, newest first", () => {
    const event = (slug: string, startsAt: string, over: Partial<PublicEvent> = {}) =>
      ({
        slug,
        title: slug,
        startsAt: new Date(startsAt),
        endsAt: null,
        timezone: "Asia/Tokyo",
        cancelledAt: null,
        finalAttendance: null,
        ...over,
      }) as PublicEvent;
    const rows = reachRows(
      [
        event("early", "2026-02-01T00:00:00Z", { finalAttendance: 40 }),
        event("late", "2026-05-01T00:00:00Z"),
        event("cancelled", "2026-03-01T00:00:00Z", {
          cancelledAt: new Date("2026-02-20T00:00:00Z"),
        }),
        event("before-period", "2025-12-31T00:00:00Z"),
        event("future", "2026-12-01T00:00:00Z"),
      ],
      { startsOn: "2026-01-01", endsOn: "2026-12-31" },
      new Date("2026-11-26T00:00:00Z"),
    );
    expect(rows.map((r) => [r.slug, r.attendance])).toEqual([
      ["late", null],
      ["early", 40],
    ]);
  });
});
