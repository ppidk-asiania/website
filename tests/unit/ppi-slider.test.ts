import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(import.meta.dirname, "../../apps/web/src/components/ppi-slider.tsx"),
  "utf8",
);

describe("home PPI slider", () => {
  it("shows each country's own scenery photo (files are named by the chapter's mapNo)", () => {
    const pairs = [...source.matchAll(/name: "([^"]+)",\s*mapNo: (\d+),/g)].map(([, name, no]) => [
      name,
      Number(no),
    ]);
    expect(Object.fromEntries(pairs)).toEqual({
      "PPI Selandia Baru": 1,
      "PPI Singapura": 2,
      "PPI Australia": 3,
      "PPI Malaysia": 4,
      "PERMITHA (PPI Thailand)": 5,
      "PPI Filipina": 6,
      "PPI Brunei Darussalam": 7,
      "PPI Tiongkok": 8,
      "PPI Taiwan": 9,
      "PERPIKA (PPI Korea Selatan)": 10,
      "PPI Jepang": 11,
      "PPI India": 12,
      "PPI Kazakhstan": 13,
      "PPI Vietnam": 14,
      "PPI Kirgistan": 15,
      "PPI Bangladesh": 16,
      "PPI Sri Lanka": 17,
    });
    expect(source).toContain("src={`/home/${country.mapNo}.png`}");
  });

  it("pins full screen while the page scroll moves the countries sideways", () => {
    const css = readFileSync(
      join(import.meta.dirname, "../../apps/web/src/app/globals.css"),
      "utf8",
    );
    const rule = (selector: string) => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";
    expect(rule(".ppi-slider")).toContain("height: calc(var(--ppi-count) * 100svh)");
    expect(rule(".ppi-slider__sticky")).toContain("position: sticky");
    expect(rule(".ppi-slider__sticky")).toContain("height: 100svh");
    expect(rule(".ppi-slider__photo")).toContain("ease-in-out");
    expect(source).toContain('window.addEventListener("scroll"');
    expect(source).not.toContain("scroll-snap");
    expect(source).toContain("ppi-slider__photo--active");
  });

  it("moves the SAME country block to the faded left spot; no second copy of the previous one", () => {
    const css = readFileSync(
      join(import.meta.dirname, "../../apps/web/src/app/globals.css"),
      "utf8",
    );
    expect(source).not.toContain("ppi-slider__ghost");
    expect(css).not.toContain("ppi-slider__ghost");
    expect(source.match(/<SlideContent /g)).toHaveLength(1);
    expect(source).toContain('setProperty("--pos"');
    expect(css).toContain(
      "left: calc(var(--ppi-left) + (var(--i) - var(--pos)) * var(--ppi-step))",
    );
  });
});
