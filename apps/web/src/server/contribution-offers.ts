import "server-only";
import type { SqlContributionWebStore } from "@website/db/sql";
import { ContributionInputSchema } from "@website/domain/inventory";
import { RuleViolationError } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";

export interface ContributionOfferDeps {
  readonly offers: Pick<SqlContributionWebStore, "offer">;
  readonly profileComplete: (userId: string) => Promise<boolean>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

type User = {
  readonly uid: string;
  readonly email: string | null;
  readonly name?: string | null;
} | null;

const noStore = { "Cache-Control": "private, no-store" };
const refused = (error: "invalid" | "profile" | "too_large", status = 400) =>
  Response.json({ ok: false, error }, { status, headers: noStore });

/** A signed-in member offers an item to give or to lend; the organisation decides in the admin (N7.3). */
export function createContributionOffers(deps: ContributionOfferDeps) {
  return async (user: User, request: Request): Promise<Response> => {
    if (!user) return jsonError("unauthenticated");
    const bytes = await readBodyLimited(request, 8_192);
    if (bytes === null) return refused("too_large", 413);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return refused("invalid");
    }
    const parsed = ContributionInputSchema.safeParse(body);
    if (!parsed.success) return refused("invalid");
    if (!(await deps.profileComplete(user.uid))) return refused("profile", 403);
    const now = deps.now();
    try {
      await deps.offers.offer(
        deps.uuid(),
        user.uid,
        user.name ?? user.email ?? "Member",
        parsed.data,
        now.toISOString().slice(0, 10),
        now,
      );
    } catch (error) {
      if (error instanceof RuleViolationError) return refused("invalid");
      throw error;
    }
    return Response.json({ ok: true }, { status: 201, headers: noStore });
  };
}
