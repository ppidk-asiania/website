import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { LinkSchema } from "../organizations/documents";
import type { EntityMeta } from "../shared";

/** The opportunities board (N6.1, DEC-30): jobs, internships, volunteer work and scholarships. */
export const OPPORTUNITY_TYPES = [
  "internship",
  "full_time",
  "part_time",
  "volunteer",
  "scholarship",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_STATUSES = ["open", "closed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export interface Opportunity extends EntityMeta {
  readonly title: string;
  readonly organization: string;
  readonly country: string;
  readonly city: string;
  readonly type: OpportunityType;
  /** Sanitised article HTML. */
  readonly description: string;
  readonly requirements: string;
  /** The last day to apply (YYYY-MM-DD), or none. */
  readonly deadline: string | null;
  /** An https link to apply elsewhere; null = apply on the platform (N6.2). */
  readonly applyUrl: string | null;
  readonly image: FeaturedImage | null;
  readonly status: OpportunityStatus;
  /** Set when a chapter posts it: that chapter's editors manage it. */
  readonly chapterId: string | null;
  readonly postedBy: string;
}

export const OpportunityInputSchema = z
  .object({
    title: safeText(160).pipe(z.string().min(3, "Enter a title.")),
    organization: safeText(120).pipe(z.string().min(2, "Enter the organisation.")),
    country: safeText(80).pipe(z.string().min(2, "Enter the country.")),
    city: safeText(80, { allowEmpty: true }),
    type: z.enum(OPPORTUNITY_TYPES, { error: "Choose a type." }),
    description: z.string().max(50_000),
    requirements: z.string().max(50_000),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")
      .nullable(),
    applyUrl: LinkSchema,
    image: FeaturedImageSchema.nullable(),
    status: z.enum(OPPORTUNITY_STATUSES),
    chapterId: safeId.nullable(),
  })
  .strict();
export type OpportunityInput = z.infer<typeof OpportunityInputSchema>;

/** open: apply; past: the deadline day is over (shown greyed); archived: closed; hidden: deleted. */
export type OpportunityPhase = "open" | "past" | "archived" | "hidden";

export function opportunityPhase(
  o: Pick<Opportunity, "status" | "deadline" | "deletedAt">,
  today: string,
): OpportunityPhase {
  if (o.deletedAt !== null) return "hidden";
  if (o.status === "closed") return "archived";
  return o.deadline !== null && o.deadline < today ? "past" : "open";
}

export const canApply = (phase: OpportunityPhase): boolean => phase === "open";

/** The board shows open and greyed postings, the archive the closed ones; nearest deadline first. */
export function boardOf(
  rows: readonly Opportunity[],
  today: string,
  list: "board" | "archive",
): Opportunity[] {
  const rank = (o: Opportunity) => (opportunityPhase(o, today) === "open" ? 0 : 1);
  return rows
    .filter((o) => {
      const phase = opportunityPhase(o, today);
      return list === "archive" ? phase === "archived" : phase === "open" || phase === "past";
    })
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31") ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
}

export function filterBoard<T extends Pick<Opportunity, "type" | "country">>(
  rows: readonly T[],
  filter: { readonly type: OpportunityType | null; readonly country: string | null },
): T[] {
  return rows.filter(
    (o) =>
      (filter.type === null || o.type === filter.type) &&
      (filter.country === null || o.country === filter.country),
  );
}

export interface PublicOpportunity {
  readonly id: string;
  readonly title: string;
  readonly organization: string;
  readonly country: string;
  readonly city: string;
  readonly type: OpportunityType;
  readonly description: string;
  readonly requirements: string;
  readonly deadline: string | null;
  readonly image: FeaturedImage | null;
  readonly phase: OpportunityPhase;
  /** Whether the apply button shows. */
  readonly apply: boolean;
  /** True: the button goes through the counting redirect; false: the platform's own form (N6.2). */
  readonly external: boolean;
}

/** The link itself is never sent: the browser only gets the redirect route, which counts the click. */
export function toPublicOpportunity(o: Opportunity, today: string): PublicOpportunity {
  const phase = opportunityPhase(o, today);
  return {
    id: o.id,
    title: o.title,
    organization: o.organization,
    country: o.country,
    city: o.city,
    type: o.type,
    description: o.description,
    requirements: o.requirements,
    deadline: o.deadline,
    image: o.image,
    phase,
    apply: canApply(phase),
    external: o.applyUrl !== null,
  };
}
