import { describe, expect, it } from "vitest";
import {
  assertNotInPast,
  assertNotOwnLoan,
  assertStep,
  isLoanOverdue,
  MemberLoanSchema,
  OutsiderLoanSchema,
} from "@website/domain/inventory";

const request = {
  itemId: "i1",
  quantity: 2,
  purpose: "Seminar",
  place: "Hall",
  from: "2026-12-01",
  to: "2026-12-03",
};

describe("loan rules (N7.2)", () => {
  it("overdue is read-time: out, and the return day has passed", () => {
    expect(isLoanOverdue({ status: "handed_over", to: "2026-12-03" }, "2026-12-04")).toBe(true);
    expect(isLoanOverdue({ status: "return_asked", to: "2026-12-03" }, "2026-12-04")).toBe(true);
    expect(isLoanOverdue({ status: "handed_over", to: "2026-12-03" }, "2026-12-03")).toBe(false);
    expect(isLoanOverdue({ status: "returned", to: "2026-12-03" }, "2026-12-09")).toBe(false);
    expect(isLoanOverdue({ status: "pending", to: "2026-12-03" }, "2026-12-09")).toBe(false);
  });

  it("only the right states allow a step", () => {
    expect(() => assertStep({ status: "pending" }, "approve")).not.toThrow();
    expect(() => assertStep({ status: "approved" }, "approve")).toThrow();
    expect(() => assertStep({ status: "pending" }, "handOver")).toThrow();
    expect(() => assertStep({ status: "return_asked" }, "takeBack")).not.toThrow();
    expect(() => assertStep({ status: "handed_over" }, "cancel")).toThrow();
  });

  it("the approver is never the borrower; an outsider has no account to clash", () => {
    expect(() => assertNotOwnLoan("u1", { kind: "member", userId: "u1" })).toThrow();
    expect(() => assertNotOwnLoan("u2", { kind: "member", userId: "u1" })).not.toThrow();
    expect(() =>
      assertNotOwnLoan("u1", {
        kind: "outsider",
        name: "A",
        email: "a@x.org",
        phone: "1",
        statementPath: "p",
      }),
    ).not.toThrow();
  });

  it("a loan cannot start in the past or end before it starts", () => {
    expect(() => assertNotInPast("2026-11-26", "2026-11-27")).toThrow();
    expect(() => assertNotInPast("2026-11-27", "2026-11-27")).not.toThrow();
    expect(MemberLoanSchema.safeParse(request).success).toBe(true);
    expect(MemberLoanSchema.safeParse({ ...request, to: "2026-11-30" }).success).toBe(false);
    expect(MemberLoanSchema.safeParse({ ...request, quantity: 0 }).success).toBe(false);
    expect(MemberLoanSchema.safeParse({ ...request, extra: 1 }).success).toBe(false);
  });

  it("an outsider must give a name, an e-mail and a phone number", () => {
    const outsider = { ...request, name: "Budi", email: "BUDI@x.org", phone: "+62811111" };
    expect(OutsiderLoanSchema.parse(outsider).email).toBe("budi@x.org");
    expect(OutsiderLoanSchema.safeParse({ ...outsider, email: "nope" }).success).toBe(false);
    expect(OutsiderLoanSchema.safeParse({ ...outsider, phone: "1" }).success).toBe(false);
  });
});
