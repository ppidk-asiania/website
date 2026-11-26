import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { FINANCE_CURRENCIES } from "../finance/requests";
import { RuleViolationError } from "../shared";
import { ItemOwnerInputSchema } from "./items";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");
const inOrder = (v: { from: string; to: string }) => v.from <= v.to;
const ORDER = { message: "The end date cannot be before the start date.", path: ["to"] };
const quantity = z.number().int().min(1).max(1000);

/* ---- Event reservations (N7.3) ------------------------------------------------------------------ */

export const RESERVATION_STATES = ["active", "released"] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

export interface Reservation {
  readonly id: string;
  readonly itemId: string;
  readonly eventId: string;
  readonly quantity: number;
  readonly from: string;
  readonly to: string;
  readonly status: ReservationState;
  readonly by: string;
  readonly createdAt: Date;
}

export const ReservationInputSchema = z
  .object({ itemId: safeId, eventId: safeId, quantity, from: day, to: day })
  .strict()
  .refine(inOrder, ORDER);
export type ReservationInput = z.infer<typeof ReservationInputSchema>;

const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) =>
  a.from <= b.to && b.from <= a.to;

/** How many units of an item are blocked for events on any day of the period. Only active ones count. */
export function reservedDuring(
  reservations: readonly Pick<Reservation, "itemId" | "quantity" | "from" | "to" | "status">[],
  itemId: string,
  period: { from: string; to: string },
): number {
  return reservations
    .filter((r) => r.status === "active" && r.itemId === itemId && overlaps(r, period))
    .reduce((sum, r) => sum + r.quantity, 0);
}

/** A reservation (or a loan) cannot take units another event has blocked on those days. */
export function assertNotReserved(stock: number, reserved: number, wanted: number): void {
  if (wanted > stock - reserved) {
    throw new RuleViolationError(
      reserved > 0
        ? `Reserved for an event on those dates: only ${Math.max(0, stock - reserved)} can be used.`
        : `Only ${stock} available.`,
    );
  }
}

/* ---- Contributions (N7.3) ------------------------------------------------------------------------ */

export const CONTRIBUTION_MODES = ["give", "lend"] as const;
export type ContributionMode = (typeof CONTRIBUTION_MODES)[number];
export const CONTRIBUTION_STATES = ["pending", "approved", "rejected"] as const;
export type ContributionState = (typeof CONTRIBUTION_STATES)[number];

/** A member offers an item: to give it, or to lend it to the organisation until a day. */
export const ContributionInputSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(2, "Name the item.")),
    description: safeText(500, { multiline: true, allowEmpty: true }),
    quantity,
    mode: z.enum(CONTRIBUTION_MODES),
    returnOn: day.nullable(),
  })
  .strict()
  .refine((v) => (v.mode === "lend") === (v.returnOn !== null), {
    message: "A lent item needs a return date; a gift has none.",
    path: ["returnOn"],
  });
export type ContributionInput = z.infer<typeof ContributionInputSchema>;

export interface Contribution {
  readonly id: string;
  readonly userId: string;
  readonly contributorName: string;
  readonly name: string;
  readonly description: string;
  readonly quantity: number;
  readonly mode: ContributionMode;
  readonly returnOn: string | null;
  readonly status: ContributionState;
  readonly itemId: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
}

/* ---- Procurement requests (N7.3) ----------------------------------------------------------------- */

export const PROCUREMENT_STATES = ["pending", "approved", "rejected", "fulfilled"] as const;
export type ProcurementState = (typeof PROCUREMENT_STATES)[number];
export const URGENCIES = ["low", "normal", "high"] as const;

export const ProcurementInputSchema = z
  .object({
    owner: ItemOwnerInputSchema,
    name: safeText(120).pipe(z.string().min(2, "Name the item.")),
    category: safeText(60, { allowEmpty: true }),
    why: safeText(500, { multiline: true }).pipe(z.string().min(3, "Say why it is needed.")),
    estimatedMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: z.enum(FINANCE_CURRENCIES),
    urgency: z.enum(URGENCIES),
  })
  .strict();
export type ProcurementInput = z.infer<typeof ProcurementInputSchema>;

export const PROCUREMENT_STEPS = {
  approve: ["pending"],
  reject: ["pending"],
  fulfil: ["approved"],
} as const satisfies Record<string, readonly ProcurementState[]>;
export type ProcurementStep = keyof typeof PROCUREMENT_STEPS;

export function assertProcurementStep(status: ProcurementState, step: ProcurementStep): void {
  if (!(PROCUREMENT_STEPS[step] as readonly ProcurementState[]).includes(status)) {
    throw new RuleViolationError("This request is not in a state where that can be done.");
  }
}

/** What a disbursement request on the Finance page starts with. Buying happens outside the platform. */
export const financePrefill = (p: {
  name: string;
  why: string;
  estimatedMinor: number;
  currency: string;
}) => ({
  title: `Purchase: ${p.name}`.slice(0, 200),
  description: p.why,
  amountMinor: p.estimatedMinor,
  currency: p.currency,
});

/* ---- Loans to outside bodies (N7.3) -------------------------------------------------------------- */

export const OutsideLoanInputSchema = z
  .object({
    itemId: safeId,
    borrower: safeText(120).pipe(z.string().min(2, "Name the borrower.")),
    contact: safeText(200).pipe(z.string().min(3, "Give a contact.")),
    purpose: safeText(300, { multiline: true }).pipe(z.string().min(3, "Say what it is for.")),
    quantity,
    conditionOut: safeText(120, { allowEmpty: true }),
    expectedBack: day,
  })
  .strict();
export type OutsideLoanInput = z.infer<typeof OutsideLoanInputSchema>;

export interface OutsideLoan {
  readonly id: string;
  readonly itemId: string;
  readonly borrower: string;
  readonly contact: string;
  readonly purpose: string;
  readonly quantity: number;
  readonly conditionOut: string;
  readonly conditionIn: string | null;
  readonly lentOn: string;
  readonly expectedBack: string;
  readonly returnedOn: string | null;
  readonly status: "out" | "returned";
}

/** Overdue by the same read-time rule as a member's loan. */
export const isOutsideOverdue = (
  loan: Pick<OutsideLoan, "status" | "expectedBack">,
  today: string,
) => loan.status === "out" && loan.expectedBack < today;
