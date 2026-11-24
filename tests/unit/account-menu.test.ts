import { describe, expect, it } from "vitest";
import { initials, shortName } from "../../packages/ui/src/user-name";
import { parseAccount } from "../../apps/web/src/lib/remembered-account";

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

describe("remembered account in the header", () => {
  it("reads back what was saved, and drops anything malformed or unsafe", () => {
    const saved = { name: "Ari Wibowo", initials: "AW", picture: "https://lh3.example/a.jpg" };
    expect(parseAccount(JSON.stringify(saved))).toEqual(saved);
    expect(parseAccount(JSON.stringify({ ...saved, picture: "javascript:alert(1)" }))).toEqual({
      ...saved,
      picture: null,
    });
    expect(parseAccount(null)).toBeNull();
    expect(parseAccount("{not json")).toBeNull();
    expect(parseAccount(JSON.stringify({ name: 1, initials: "AW" }))).toBeNull();
  });
});
