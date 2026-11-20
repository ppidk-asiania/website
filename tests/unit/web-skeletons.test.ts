import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(import.meta.dirname, "../../apps/web/src");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

// Pages whose lists load from the database inside <Suspense>.
const DATA_PAGES = [
  "app/page.tsx",
  "app/events/page.tsx",
  "app/news/page.tsx",
  "app/gallery/page.tsx",
  "app/map/page.tsx",
  "app/activities/page.tsx",
];

describe("web pages show a skeleton while their data loads", () => {
  it.each(DATA_PAGES)("%s has no empty Suspense fallback", (page) => {
    expect(read(page)).not.toContain("fallback={null}");
  });

  it("styles one shimmering skeleton block with the design tokens", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.site-skeleton\s*\{[^}]*animation:\s*site-skeleton/);
    expect(css).toContain("@keyframes site-skeleton");
  });

  it("hides the placeholders from assistive technology", () => {
    expect(read("components/site-skeleton.tsx")).toContain('aria-hidden="true"');
  });
});
