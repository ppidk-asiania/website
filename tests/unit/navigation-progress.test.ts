import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPageChange } from "../../packages/ui/src/page-change";

const ROOT = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("top loading bar starts only for a real page change", () => {
  const here = "https://example.org/events?page=1";

  it("starts for another path or another query on this site", () => {
    expect(isPageChange(here, "/news")).toBe(true);
    expect(isPageChange(here, "/events?page=2")).toBe(true);
    expect(isPageChange(here, "https://example.org/gallery")).toBe(true);
  });

  it("ignores the same page, a #hash jump and other sites", () => {
    expect(isPageChange(here, "/events?page=1")).toBe(false);
    expect(isPageChange(here, "/events?page=1#top")).toBe(false);
    expect(isPageChange(here, "https://other.example/events")).toBe(false);
    expect(isPageChange(here, "mailto:a@b.c")).toBe(false);
  });
});

describe("top loading bar is mounted in the web and admin layouts", () => {
  it.each(["apps/web/src/app/layout.tsx", "apps/admin/src/app/layout.tsx"])("%s", (layout) => {
    expect(read(layout)).toContain("<RouteProgress />");
  });

  it("is styled once in the shared stylesheet", () => {
    expect(read("packages/ui/src/styles.css")).toContain(".ui-progress");
  });
});
