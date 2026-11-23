import { describe, expect, it } from "vitest";
import { initials, shortName } from "../../packages/ui/src/user-name";

describe("avatar initials", () => {
  it("uses the first and last name", () => {
    expect(initials("Nevyllo Zamuel Kalangi")).toBe("NK");
    expect(initials("  ari   wibowo ")).toBe("AW");
  });

  it("falls back to two letters of a single word, or '?' when empty", () => {
    expect(initials("nevyllokalangi")).toBe("NE");
    expect(initials("A")).toBe("A");
    expect(initials("   ")).toBe("?");
  });
});

describe("short name in the header", () => {
  it("keeps names of up to 16 characters", () => {
    expect(shortName("Ari Wibowo")).toBe("Ari Wibowo");
    expect(shortName("Sixteen chars ok")).toBe("Sixteen chars ok");
  });

  it("cuts longer names to 13 characters and three dots", () => {
    expect(shortName("Muhammad Muflih Naufal Kamil")).toBe("Muhammad Mufl...");
    expect(shortName("Seventeen chars!!")).toBe("Seventeen cha...");
  });
});
