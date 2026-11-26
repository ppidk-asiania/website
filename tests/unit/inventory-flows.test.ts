import { describe, expect, it } from "vitest";
import {
  assertNotReserved,
  assertProcurementStep,
  ContributionInputSchema,
  isOutsideOverdue,
  reservedDuring,
} from "@website/domain/inventory";

const r = (
  quantity: number,
  from: string,
  to: string,
  status: "active" | "released" = "active",
) => ({
  itemId: "i1",
  quantity,
  from,
  to,
  status,
});

describe("flows rules (N7.3)", () => {
  it("counts only active reservations of the item that touch the period", () => {
    const list = [
      r(2, "2026-12-01", "2026-12-03"),
      r(1, "2026-12-03", "2026-12-05"),
      r(5, "2026-12-01", "2026-12-03", "released"),
      { ...r(4, "2026-12-01", "2026-12-03"), itemId: "other" },
    ];
    expect(reservedDuring(list, "i1", { from: "2026-12-03", to: "2026-12-03" })).toBe(3);
    expect(reservedDuring(list, "i1", { from: "2026-12-04", to: "2026-12-04" })).toBe(1);
    expect(reservedDuring(list, "i1", { from: "2026-12-06", to: "2026-12-07" })).toBe(0);
  });

  it("refuses what the blocks leave out, and says how many are left", () => {
    expect(() => assertNotReserved(3, 2, 1)).not.toThrow();
    expect(() => assertNotReserved(3, 2, 2)).toThrow("only 1");
    expect(() => assertNotReserved(1, 0, 2)).toThrow("Only 1 available");
  });

  it("a lend needs a return date and a gift has none", () => {
    const base = { name: "Tent", description: "", quantity: 1 };
    expect(
      ContributionInputSchema.safeParse({ ...base, mode: "lend", returnOn: "2026-12-31" }).success,
    ).toBe(true);
    expect(
      ContributionInputSchema.safeParse({ ...base, mode: "lend", returnOn: null }).success,
    ).toBe(false);
    expect(
      ContributionInputSchema.safeParse({ ...base, mode: "give", returnOn: "2026-12-31" }).success,
    ).toBe(false);
    expect(
      ContributionInputSchema.safeParse({ ...base, mode: "give", returnOn: null }).success,
    ).toBe(true);
  });

  it("procurement moves pending → approved → fulfilled only", () => {
    expect(() => assertProcurementStep("pending", "approve")).not.toThrow();
    expect(() => assertProcurementStep("approved", "fulfil")).not.toThrow();
    expect(() => assertProcurementStep("pending", "fulfil")).toThrow();
    expect(() => assertProcurementStep("fulfilled", "approve")).toThrow();
  });

  it("an outside loan is overdue the day after it should be back", () => {
    expect(isOutsideOverdue({ status: "out", expectedBack: "2026-12-05" }, "2026-12-06")).toBe(
      true,
    );
    expect(isOutsideOverdue({ status: "out", expectedBack: "2026-12-05" }, "2026-12-05")).toBe(
      false,
    );
    expect(isOutsideOverdue({ status: "returned", expectedBack: "2026-12-05" }, "2026-12-09")).toBe(
      false,
    );
  });
});
