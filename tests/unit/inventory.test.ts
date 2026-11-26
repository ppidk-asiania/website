import { describe, expect, it } from "vitest";
import {
  actionForCondition,
  isListed,
  putOnShelf,
  scopeOfItem,
  stockAfterTotalChange,
  takeFromShelf,
} from "@website/domain/inventory";

describe("stock maths (N7.1)", () => {
  it("a new total moves `available` with it", () => {
    expect(stockAfterTotalChange({ total: 10, available: 4 }, 12)).toEqual({
      total: 12,
      available: 6,
    });
  });

  it("what is out on loan stays out: the total cannot go below it", () => {
    expect(() => stockAfterTotalChange({ total: 10, available: 4 }, 5)).toThrow(/out on loan/);
    expect(stockAfterTotalChange({ total: 10, available: 4 }, 6)).toEqual({
      total: 6,
      available: 0,
    });
  });

  it("refuses a fraction, a negative and a huge number", () => {
    for (const bad of [1.5, -1, 1_000_000]) {
      expect(() => stockAfterTotalChange({ total: 1, available: 1 }, bad)).toThrow();
    }
  });

  it("taking never goes below 0 and putting back never above the total", () => {
    expect(takeFromShelf({ available: 3 }, 3)).toBe(0);
    expect(() => takeFromShelf({ available: 3 }, 4)).toThrow(/Only 3/);
    expect(() => takeFromShelf({ available: 3 }, 0)).toThrow();
    expect(putOnShelf({ total: 5, available: 4 }, 3)).toBe(5);
  });
});

describe("catalogue rules (N7.1)", () => {
  const item = { published: true, condition: "good", deletedAt: null } as const;

  it("retired, hidden and deleted items are not listed; damaged ones are", () => {
    expect(isListed(item)).toBe(true);
    expect(isListed({ ...item, condition: "damaged" })).toBe(true);
    expect(isListed({ ...item, condition: "retired" })).toBe(false);
    expect(isListed({ ...item, published: false })).toBe(false);
    expect(isListed({ ...item, deletedAt: new Date() })).toBe(false);
  });

  it("names the log action of a condition change", () => {
    expect(actionForCondition("good", "damaged")).toBe("damaged");
    expect(actionForCondition("damaged", "retired")).toBe("retired");
    expect(actionForCondition("damaged", "good")).toBe("adjusted");
  });

  it("the region is global; a chapter or a unit is that scope", () => {
    expect(scopeOfItem({ kind: "region" })).toEqual({});
    expect(scopeOfItem({ kind: "chapter", chapterId: "c1" })).toEqual({ chapterId: "c1" });
    expect(scopeOfItem({ kind: "unit", orgUnitId: "u2", orgUnitPath: ["u1", "u2"] })).toEqual({
      orgUnitPath: ["u1", "u2"],
    });
  });
});
