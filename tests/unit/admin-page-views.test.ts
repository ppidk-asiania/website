import { describe, expect, it } from "vitest";
import {
  axisTicks,
  pageOptions,
  pointLabel,
} from "../../apps/admin/src/components/page-views-model";

describe("page views chart (Dashboard)", () => {
  it("steps the views axis in round numbers from 0 to just above the highest day", () => {
    expect(axisTicks(110)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    expect(axisTicks(1_699)).toEqual([0, 500, 1_000, 1_500, 2_000]);
    expect(axisTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(axisTicks(0)).toEqual([0, 1]); // no views yet: still an axis
  });

  it("names a day, a month and a year the short way", () => {
    expect(pointLabel("2026-10-11")).toBe("Oct 11");
    expect(pointLabel("2026-11")).toBe("Nov 2026");
    expect(pointLabel("2026")).toBe("2026");
  });

  it("offers all pages, then each page viewed in the period, and keeps the chosen one", () => {
    const pages = [{ page: "/news" }, { page: "/" }];
    expect(pageOptions(pages, "*")).toEqual([
      { value: "*", label: "All pages" },
      { value: "/news", label: "/news" },
      { value: "/", label: "/" },
    ]);
    // A page with no views in this period is still listed while it is chosen.
    expect(pageOptions(pages, "/events").map((o) => o.value)).toEqual([
      "*",
      "/events",
      "/news",
      "/",
    ]);
  });
});
