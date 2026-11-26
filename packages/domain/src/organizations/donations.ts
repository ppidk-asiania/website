import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { RuleViolationError, type EntityMeta } from "../shared";
import type { CashEntry } from "../finance/cashbook";
import { FINANCE_CURRENCIES } from "../finance/requests";

/** Donations (N5.4, DEC-26): paid outside the platform, a person checks the proof, one cash book line per donation. */
export interface DonationChannel extends EntityMeta {
  readonly label: string;
  /** Account number, holder name, how to transfer: shown to signed-in members only. */
  readonly details: string;
  /** A public image: a QR code or the bank logo. */
  readonly image: FeaturedImage | null;
  readonly currency: (typeof FINANCE_CURRENCIES)[number];
  readonly published: boolean;
}

export const DonationChannelInputSchema = z
  .object({
    label: safeText(80).pipe(z.string().min(2, "Name the channel.")),
    details: safeText(1000, { multiline: true }).pipe(
      z.string().min(2, "Write how to send the donation."),
    ),
    image: FeaturedImageSchema.nullable(),
    currency: z.enum(FINANCE_CURRENCIES),
    published: z.boolean(),
  })
  .strict();
export type DonationChannelInput = z.infer<typeof DonationChannelInputSchema>;

export type PublicDonationChannel = Pick<
  DonationChannel,
  "id" | "label" | "details" | "image" | "currency"
>;

export const DONATION_STATES = ["pending", "verified", "rejected"] as const;
export type DonationState = (typeof DONATION_STATES)[number];

/** What a donor sends; the amount is typed in major units and converted on the server with the channel's currency. */
export const DonationInputSchema = z
  .object({
    channelId: safeId,
    amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    message: safeText(300, { multiline: true, allowEmpty: true }),
    showName: z.boolean(),
  })
  .strict();
export type DonationInput = z.infer<typeof DonationInputSchema>;

/** The wall of supporters: a name only when the donor chose it, never an amount. */
export interface Supporter {
  readonly id: string;
  readonly name: string | null;
  readonly at: Date;
}

export function assertNotOwnDonation(verifier: string, donor: string): void {
  if (verifier === donor) throw new RuleViolationError("Someone else must check your donation.");
}

/** One income line; its id is the donation id, so a donation cannot reach the cash book twice. */
export function cashEntryFromDonation(donation: {
  donationId: string;
  periodId: string;
  channel: string;
  amountMinor: number;
  currency: CashEntry["currency"];
  at: Date;
  verifiedBy: string;
}): CashEntry {
  return {
    id: donation.donationId,
    periodId: donation.periodId,
    orgUnitId: null,
    date: donation.at.toISOString().slice(0, 10),
    kind: "in",
    category: "donation",
    description: `Donation: ${donation.channel}`,
    amountMinor: donation.amountMinor,
    currency: donation.currency,
    source: "donation",
    requestId: null,
    proof: null,
    createdBy: donation.verifiedBy,
    createdAt: donation.at,
  };
}
