import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("architecture", () => {
  it("boundary check passes", () => {
    const out = execFileSync(process.execPath, ["scripts/check-boundaries.mjs"], {
      encoding: "utf8",
    });
    expect(out).toContain("Architecture boundaries OK");
  });
});
