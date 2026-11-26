import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";

/** Borrowing (N7.2): a member or an outsider asks, an approver decides, the item goes out and comes back. */
export const LOAN_STATES = [
  "pending",
  "approved",
  "rejected",
  "handed_over",
  "return_asked",
  "returned",
  "cancelled",
] as const;
export type LoanState = (typeof LOAN_STATES)[number];

/** Items are out in these states: they count against `available` and can become overdue. */
export const OUT_STATES: readonly LoanState[] = ["handed_over", "return_asked"];

export type Borrower =
  | { readonly kind: "member"; readonly userId: string }
  | {
      readonly kind: "outsider";
      readonly name: string;
      readonly email: string;
      readonly phone: string;
      /** The signed statement (a PDF on the private file store). */
      readonly statementPath: string;
    };

export interface Loan {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly purpose: string;
  readonly place: string;
  readonly from: string;
  readonly to: string;
  readonly borrower: Borrower;
  readonly status: LoanState;
  readonly note: string | null;
  readonly decidedBy: string | null;
  readonly handedOverAt: Date | null;
  readonly returnedAt: Date | null;
  readonly returnCondition: "good" | "damaged" | null;
  readonly createdAt: Date;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");

const loanFields = {
  itemId: safeId,
  quantity: z.number().int().min(1).max(1000),
  purpose: safeText(300, { multiline: true }).pipe(z.string().min(3, "Say what it is for.")),
  place: safeText(120).pipe(z.string().min(2, "Say where it will be used.")),
  from: day,
  to: day,
};

const inOrder = (v: { from: string; to: string }) => v.from <= v.to;
const ORDER = { message: "The return date cannot be before the start date.", path: ["to"] };

export const MemberLoanSchema = z.object(loanFields).strict().refine(inOrder, ORDER);
export type MemberLoanInput = z.infer<typeof MemberLoanSchema>;

/** An outsider adds who they are; the statement PDF travels as the request body. */
export const OutsiderLoanSchema = z
  .object({
    ...loanFields,
    name: safeText(120).pipe(z.string().min(2, "Enter your name.")),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid e-mail.")),
    phone: safeText(30).pipe(z.string().min(6, "Enter a phone or WhatsApp number.")),
  })
  .strict()
  .refine(inOrder, ORDER);
export type OutsiderLoanInput = z.infer<typeof OutsiderLoanSchema>;

/** A loan cannot start in the past. */
export function assertNotInPast(from: string, today: string): void {
  if (from < today) throw new RuleViolationError("The start date cannot be in the past.");
}

/** Overdue is a READ-TIME rule: out, and the day of return has passed. Nothing is stored. */
export const isLoanOverdue = (loan: Pick<Loan, "status" | "to">, today: string): boolean =>
  OUT_STATES.includes(loan.status) && loan.to < today;

/** The approver is never the borrower. */
export function assertNotOwnLoan(actor: string, borrower: Borrower): void {
  if (borrower.kind === "member" && borrower.userId === actor) {
    throw new RuleViolationError("Someone else must decide on your own request.");
  }
}

/** The steps an approver or the borrower may take from a state. */
export const LOAN_STEPS = {
  approve: ["pending"],
  reject: ["pending"],
  handOver: ["approved"],
  askReturn: ["handed_over"],
  takeBack: ["handed_over", "return_asked"],
  cancel: ["pending", "approved"],
} as const satisfies Record<string, readonly LoanState[]>;
export type LoanStep = keyof typeof LOAN_STEPS;

export function assertStep(loan: Pick<Loan, "status">, step: LoanStep): void {
  if (!(LOAN_STEPS[step] as readonly LoanState[]).includes(loan.status)) {
    throw new RuleViolationError("This request is not in a state where that can be done.");
  }
}

export const RETURN_CONDITIONS = ["good", "damaged"] as const;
