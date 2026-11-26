import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { FINANCE_CURRENCIES } from "../finance/requests";
import { RuleViolationError } from "../shared";

/** The chosen ticket cannot be bought now (full, or no price yet): the page says so in the visitor's language. */
export class TicketUnavailableError extends RuleViolationError {}

/** Payment of a registration (N1.3, DEC-26): paid outside the platform, a person checks the proof. */
export const PAYMENT_STATES = [
  "not_required",
  "unpaid",
  "submitted",
  "verified",
  "rejected",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export interface FeeCategory {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: number;
  /** Price when registered on or before `earlyUntil`; null = no early price. */
  readonly earlyAmountMinor: number | null;
  /** Places in this category; null = no limit. */
  readonly quota: number | null;
}

export interface EventFee {
  /** Separate from the amounts: the price may be filled in later. */
  readonly paid: boolean;
  readonly currency: (typeof FINANCE_CURRENCIES)[number];
  readonly categories: readonly FeeCategory[];
  readonly earlyUntil: Date | null;
  readonly instructions: string;
  /** A public image: a QR code or the account details. */
  readonly payImage: FeaturedImage | null;
}

const amount = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const FeeCategorySchema = z
  .object({
    id: safeId.or(z.literal("")),
    label: safeText(80).pipe(z.string().min(1, "Name each category.")),
    amountMinor: amount,
    earlyAmountMinor: amount.nullable(),
    quota: z.number().int().min(1).max(100_000).nullable(),
  })
  .strict()
  .refine((c) => c.earlyAmountMinor === null || c.earlyAmountMinor < c.amountMinor, {
    message: "The early price must be lower than the normal price.",
    path: ["earlyAmountMinor"],
  });

export const EventFeeInputSchema = z
  .object({
    paid: z.boolean(),
    currency: z.enum(FINANCE_CURRENCIES),
    categories: z.array(FeeCategorySchema).max(12),
    earlyUntil: z.coerce.date().nullable(),
    instructions: safeText(1000, { multiline: true, allowEmpty: true }),
    payImage: FeaturedImageSchema.nullable(),
  })
  .strict()
  .refine(
    (fee) =>
      new Set(fee.categories.map((c) => c.label.toLowerCase())).size === fee.categories.length,
    {
      message: "Each category needs its own name.",
      path: ["categories"],
    },
  )
  .refine(
    (fee) =>
      fee.earlyUntil === null ||
      fee.categories.length === 0 ||
      fee.categories.some((c) => c.earlyAmountMinor !== null),
    {
      message: "Give at least one category an early price, or clear the early date.",
      path: ["earlyUntil"],
    },
  );
export type EventFeeInput = z.infer<typeof EventFeeInputSchema>;

/** What the public page shows: the prices, never the payment instructions. */
export interface PublicFee {
  readonly paid: boolean;
  readonly currency: EventFee["currency"];
  readonly categories: readonly Pick<
    FeeCategory,
    "id" | "label" | "amountMinor" | "earlyAmountMinor"
  >[];
  readonly earlyUntil: Date | null;
}

export const toPublicFee = (fee: EventFee | null): PublicFee | null =>
  fee?.paid
    ? {
        paid: true,
        currency: fee.currency,
        categories: fee.categories.map(({ id, label, amountMinor, earlyAmountMinor }) => ({
          id,
          label,
          amountMinor,
          earlyAmountMinor,
        })),
        earlyUntil: fee.earlyUntil,
      }
    : null;

export function findCategory<C extends { readonly id: string }>(
  fee: { readonly categories: readonly C[] },
  id: string | null,
): C {
  const category = fee.categories.find((c) => c.id === id);
  if (!category) throw new RuleViolationError("Choose a ticket category.");
  return category;
}

/** The early price applies to a registration made on or before `earlyUntil`. */
export function feeAmount(
  fee: {
    readonly categories: readonly Pick<FeeCategory, "id" | "amountMinor" | "earlyAmountMinor">[];
    readonly earlyUntil: Date | null;
  },
  categoryId: string | null,
  registeredAt: Date,
): number {
  const category = findCategory(fee, categoryId);
  const early =
    category.earlyAmountMinor !== null && fee.earlyUntil !== null && registeredAt <= fee.earlyUntil;
  return early ? category.earlyAmountMinor : category.amountMinor;
}

/** A category holds one place per registration that was not cancelled (a pending one holds its seat). */
export function assertCategoryOpen(category: FeeCategory, held: number): void {
  if (category.quota !== null && held >= category.quota) {
    throw new TicketUnavailableError(`"${category.label}" is full. Choose another category.`);
  }
}

/** A paid event needs categories before anyone can register. */
export function assertFeeReady(fee: Pick<EventFee, "categories">): void {
  if (fee.categories.length === 0) {
    throw new TicketUnavailableError("The ticket price is not set yet. Try again later.");
  }
}

/** Who may verify: never the person who paid. */
export function assertNotOwnPayment(verifier: string, registrant: string): void {
  if (verifier === registrant) {
    throw new RuleViolationError("Someone else must check your payment.");
  }
}

/** A proof can be sent while the payment is waiting for it, or again after a rejection. */
export const canSendProof = (state: PaymentState): boolean =>
  state === "unpaid" || state === "rejected";
