import type { EntityMeta } from "../shared";

export type SubscriptionStatus = "pending" | "confirmed" | "unsubscribed" | "suppressed";

export interface Subscriber extends EntityMeta {
  readonly email: string;
  readonly status: SubscriptionStatus;
  readonly confirmedAt: Date | null;
}

/** Double opt-in: only confirmed, non-suppressed subscribers may receive campaigns. */
export function canReceiveCampaigns(subscriber: Pick<Subscriber, "status" | "deletedAt">): boolean {
  return subscriber.status === "confirmed" && subscriber.deletedAt === null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Abuse-prevention port (reCAPTCHA today). Fail-open vs fail-closed is decided by the caller. */
export interface CaptchaVerifier {
  verify(
    token: string,
    expectedAction: string,
  ): Promise<{ success: boolean; score: number | null }>;
}
