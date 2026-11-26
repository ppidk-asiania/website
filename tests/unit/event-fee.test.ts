import { describe, expect, it } from "vitest";
import {
  EventFeeInputSchema,
  assertCategoryOpen,
  assertFeeReady,
  assertNotOwnPayment,
  canSendProof,
  feeAmount,
  toPublicFee,
  type EventFee,
} from "@website/domain/events";
import { RuleViolationError } from "@website/domain/shared";

const fee: EventFee = {
  paid: true,
  currency: "CNY",
  categories: [
    { id: "std", label: "Student", amountMinor: 5000, earlyAmountMinor: 3000, quota: 2 },
    { id: "pro", label: "Professional", amountMinor: 9000, earlyAmountMinor: null, quota: null },
  ],
  earlyUntil: new Date("2026-11-10T00:00:00Z"),
  instructions: "Transfer to the account in the image.",
  payImage: null,
};
const input = (over: Record<string, unknown> = {}) => ({
  paid: true,
  currency: "CNY",
  categories: [
    { id: "", label: "Student", amountMinor: 5000, earlyAmountMinor: 3000, quota: null },
  ],
  earlyUntil: "2026-11-10T00:00:00Z",
  instructions: "",
  payImage: null,
  ...over,
});

describe("event fee maths (N1.3)", () => {
  it("charges the early price up to and including the early date, then the normal one", () => {
    expect(feeAmount(fee, "std", new Date("2026-11-09T12:00:00Z"))).toBe(3000);
    expect(feeAmount(fee, "std", new Date("2026-11-10T00:00:00Z"))).toBe(3000);
    expect(feeAmount(fee, "std", new Date("2026-11-10T00:00:01Z"))).toBe(5000);
  });

  it("charges the normal price when the category or the event has no early price", () => {
    expect(feeAmount(fee, "pro", new Date("2026-11-01T00:00:00Z"))).toBe(9000);
    expect(feeAmount({ ...fee, earlyUntil: null }, "std", new Date("2026-11-01T00:00:00Z"))).toBe(
      5000,
    );
  });

  it("refuses an unknown or missing category", () => {
    expect(() => feeAmount(fee, "vip", new Date())).toThrow(RuleViolationError);
    expect(() => feeAmount(fee, null, new Date())).toThrow(RuleViolationError);
  });

  it("closes a category at its quota and leaves an unlimited one open", () => {
    const [std, pro] = fee.categories as [
      EventFee["categories"][number],
      EventFee["categories"][number],
    ];
    expect(() => assertCategoryOpen(std, 1)).not.toThrow();
    expect(() => assertCategoryOpen(std, 2)).toThrow(/full/);
    expect(() => assertCategoryOpen(pro, 100_000)).not.toThrow();
  });

  it("waits for a price: no categories means nobody can register yet", () => {
    expect(() => assertFeeReady({ categories: [] })).toThrow(RuleViolationError);
    expect(() => assertFeeReady(fee)).not.toThrow();
  });

  it("never lets the payer verify their own payment", () => {
    expect(() => assertNotOwnPayment("u1", "u1")).toThrow(RuleViolationError);
    expect(() => assertNotOwnPayment("u2", "u1")).not.toThrow();
  });

  it("accepts a proof while unpaid and again after a rejection, not once sent or verified", () => {
    expect(["unpaid", "rejected"].every((s) => canSendProof(s as never))).toBe(true);
    expect(["not_required", "submitted", "verified"].some((s) => canSendProof(s as never))).toBe(
      false,
    );
  });

  it("publishes prices but never the payment instructions", () => {
    expect(toPublicFee(fee)).toEqual({
      paid: true,
      currency: "CNY",
      categories: [
        { id: "std", label: "Student", amountMinor: 5000, earlyAmountMinor: 3000 },
        { id: "pro", label: "Professional", amountMinor: 9000, earlyAmountMinor: null },
      ],
      earlyUntil: fee.earlyUntil,
    });
    expect(toPublicFee({ ...fee, paid: false })).toBeNull();
    expect(toPublicFee(null)).toBeNull();
  });

  it("validates the form: whole amounts, early below normal, unique names, an early price to use", () => {
    expect(EventFeeInputSchema.safeParse(input()).success).toBe(true);
    expect(EventFeeInputSchema.safeParse(input({ categories: [] })).success).toBe(true);
    const bad = (categories: unknown[], over: Record<string, unknown> = {}) =>
      EventFeeInputSchema.safeParse(input({ categories, ...over })).success;
    const one = { id: "", label: "A", amountMinor: 5000, earlyAmountMinor: null, quota: null };
    expect(bad([{ ...one, earlyAmountMinor: 5000 }])).toBe(false);
    expect(bad([{ ...one, amountMinor: 50.5 }])).toBe(false);
    expect(bad([{ ...one, amountMinor: 0 }])).toBe(false);
    expect(bad([one, { ...one, id: "b", label: "a" }])).toBe(false);
    expect(bad([one])).toBe(false); // an early date with no early price anywhere
    expect(bad([one], { earlyUntil: null })).toBe(true);
    expect(bad([one], { currency: "XXX", earlyUntil: null })).toBe(false);
  });
});
