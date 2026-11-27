import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const TOKENS = "packages/ui/src/styles.css";
const tokens = readFileSync(join(ROOT, TOKENS), "utf8");

function files(dir: string, extensions: string[]): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return files(path, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

const styleSources = [
  ...["apps/web/src", "apps/admin/src", "apps/store/src", "packages/ui/src"].flatMap((dir) =>
    files(dir, [".css", ".tsx"]),
  ),
].filter((path) => path.replaceAll("\\", "/") !== TOKENS);

describe("design tokens (one global stylesheet shared by every app)", () => {
  it("defines the brand palette", () => {
    for (const hex of ["#1f0006", "#3a000c", "#a8173a", "#e6b15a", "#ecd7d6", "#fcf4f3"]) {
      expect(tokens.toLowerCase()).toContain(hex);
    }
  });

  it("defines the Poppins type scale (size / line-height)", () => {
    const scale: Record<string, [string, string]> = {
      xs: ["0.75rem", "1.5"],
      sm: ["0.875rem", "1.5"],
      base: ["1rem", "1.5"],
      lg: ["1.125rem", "1.5"],
      xl: ["1.25rem", "1.4"],
      "2xl": ["1.5rem", "1.3"],
      "3xl": ["1.875rem", "1.2"],
      "4xl": ["2.25rem", "1.2"],
      "5xl": ["3rem", "1"],
      "6xl": ["3.75rem", "1"],
    };
    for (const [step, [size, leading]] of Object.entries(scale)) {
      expect(tokens).toContain(`--text-${step}: ${size};`);
      expect(tokens).toContain(`--leading-${step}: ${leading};`);
      expect(tokens).toMatch(new RegExp(`\\.text-${step}\\s*\\{`));
    }
    expect(tokens).toMatch(/--font-sans:\s*var\(--font-poppins\)/);
  });

  it("no app or component hardcodes colours", () => {
    for (const path of styleSources) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}\b(?![\w-])/i);
      expect(source, path).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/i);
    }
  });

  it("CSS outside the token file takes colours, type, radius, spacing and shadows from tokens", () => {
    const tokenised =
      /^\s*(color|background(-color)?|border(-\w+)?-color|font-size|line-height|font-weight|font-family|letter-spacing|border-radius|padding(-\w+)?|margin(-\w+)?|gap|row-gap|column-gap|box-shadow|outline-offset)\s*:\s*(.+?);/gm;
    const allowed = /^(0|auto|none|inherit|transparent|currentColor|unset)$/;
    for (const path of styleSources.filter((p) => p.endsWith(".css"))) {
      const source = readFileSync(join(ROOT, path), "utf8");
      for (const match of source.matchAll(tokenised)) {
        const value = (match[match.length - 1] ?? "").trim();
        if (allowed.test(value) || value.includes("var(")) continue;
        throw new Error(`${path}: "${match[0].trim()}" must use a design token (var(--…))`);
      }
    }
  });
});

describe("admin accessibility and native forms", () => {
  const tsx = files("apps/admin/src", [".tsx"]).map((path) => ({
    path,
    source: readFileSync(join(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm, ""),
  }));

  it("uses real buttons: every <button> has a type, nothing pretends to be one", () => {
    for (const { path, source } of tsx) {
      for (const match of source.matchAll(/<button\b([^>]*?)>/gs)) {
        expect(match[1], path).toMatch(/\btype=/);
      }
      expect(source, path).not.toContain('role="button"');
    }
    const button = readFileSync(join(ROOT, "apps/admin/src/components/ui/button.tsx"), "utf8");
    expect(button).toContain('type = "button"');
    expect(button).toContain("aria-busy={busy || undefined}");
    expect(button).toContain("reportValidity()");
  });

  it("puts every editor in a <form> whose action button submits (native validation)", () => {
    const editors = [
      "articles-page.tsx",
      "events-page.tsx",
      "finance-page.tsx",
      "forms-page.tsx",
      "gallery-page.tsx",
      "incoming-page.tsx",
      "letter-types-page.tsx",
      "letters-page.tsx",
      "newsletter-page.tsx",
      "recruitment-page.tsx",
      "participants-page.tsx",
      "certificate-send-panel.tsx",
    ];
    for (const name of editors) {
      const source = readFileSync(join(ROOT, "apps/admin/src/components", name), "utf8");
      expect(source, name).toMatch(/<form\b/);
      expect(source, name).toMatch(/<Button\s+type="submit"/);
    }
    for (const { path, source } of tsx) {
      if (!/type="submit"/.test(source)) continue;
      expect(source, path).toMatch(/<form\b|\basForm\b|\bform="/);
    }
  });

  it("connects a label to every field", () => {
    for (const { path, source } of tsx) {
      for (const match of source.matchAll(
        /<(input|textarea|Select)\b((?:=>|[^<>=]|=(?!>)|\{(?:=>|[^{}]|\{[^{}]*\})*\})*?)\/?>/gs,
      )) {
        const attrs = match[2] ?? "";
        if (/type="(hidden|file)"|\shidden\b/.test(attrs)) continue;
        const before = source.slice(Math.max(0, (match.index ?? 0) - 600), match.index);
        const insideLabel = before.lastIndexOf("<label") > before.lastIndexOf("</label>");
        expect(
          /\bid=|aria-label/.test(attrs) || insideLabel,
          `${path}: ${attrs.slice(0, 60)}`,
        ).toBe(true);
      }
    }
  });
});
