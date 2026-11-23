import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ORGANISATION_NAME } from "@website/domain/shared";

const OLD_SPELLING = /Dunia Kawasan/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return /^(node_modules|\.next|\.git|history)$/.test(entry.name) ? [] : sourceFiles(path);
    return /\.(tsx?|json|md)$/.test(entry.name) ? [path] : [];
  });
}

describe("official organisation name", () => {
  it("has the Indonesian long name from the decision", () => {
    expect(ORGANISATION_NAME.id).toBe("PERHIMPUNAN PELAJAR INDONESIA DUNIA KAWASAN ASIA-OSEANIA");
  });

  it("keeps the old spelling out of apps, packages and docs (docs/history excepted)", () => {
    const hits = ["apps", "packages", "docs"]
      .flatMap((root) => sourceFiles(join(process.cwd(), root)))
      .filter((file) => OLD_SPELLING.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });
});
