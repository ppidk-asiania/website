import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { RuleViolationError, type EntityMeta } from "../shared";

/** Inventory (N7.1, DEC-31): equipment owned by the region, a chapter or a unit that others may borrow. */
export const ITEM_CONDITIONS = ["good", "damaged", "retired"] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const MAX_STOCK = 100_000;

/** Every item has ONE owner; that owner's `inventory.edit` holders manage it (the usual scopes). */
export type ItemOwner =
  | { readonly kind: "region" }
  | { readonly kind: "chapter"; readonly chapterId: string }
  | { readonly kind: "unit"; readonly orgUnitId: string; readonly orgUnitPath: readonly string[] };

/** What the form sends: for a unit the server adds the path (it is never taken from the browser). */
export const ItemOwnerInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("region") }).strict(),
  z.object({ kind: z.literal("chapter"), chapterId: safeId }).strict(),
  z.object({ kind: z.literal("unit"), orgUnitId: safeId }).strict(),
]);
export type ItemOwnerInput = z.infer<typeof ItemOwnerInputSchema>;

export interface InventoryItem extends EntityMeta {
  readonly owner: ItemOwner;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly image: FeaturedImage | null;
  readonly total: number;
  readonly available: number;
  readonly condition: ItemCondition;
  readonly location: string;
  /** The person who keeps it: an account, or a typed name. */
  readonly custodianUserId: string | null;
  readonly custodianName: string | null;
  readonly published: boolean;
  /** An item lent to the organisation (N7.3): whose it is and when it goes back. */
  readonly lentBy: { readonly name: string; readonly returnOn: string | null } | null;
}

const count = z.number().int().min(0).max(MAX_STOCK);

export const InventoryItemInputSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(2, "Name the item.")),
    category: safeText(60, { allowEmpty: true }),
    description: safeText(1000, { multiline: true, allowEmpty: true }),
    image: FeaturedImageSchema.nullable(),
    condition: z.enum(ITEM_CONDITIONS),
    location: safeText(120, { allowEmpty: true }),
    custodianUserId: safeId.nullable(),
    custodianName: safeText(120, { allowEmpty: true }),
    published: z.boolean(),
  })
  .strict();
export type InventoryItemInput = z.infer<typeof InventoryItemInputSchema>;

/** A new item also says who owns it and how many there are. */
export const NewItemInputSchema = InventoryItemInputSchema.extend({
  owner: ItemOwnerInputSchema,
  total: count,
}).strict();

/** The permission scope of an item: the region is global, a chapter or a unit is that scope. */
export const scopeOfItem = (
  owner: ItemOwner,
): { chapterId?: string; orgUnitPath?: readonly string[] } =>
  owner.kind === "chapter"
    ? { chapterId: owner.chapterId }
    : owner.kind === "unit"
      ? { orgUnitPath: owner.orgUnitPath }
      : {};

/** The stock after the total changes by `delta`: what is out on loan stays out, so none may go below 0. */
export function stockAfterTotalChange(
  item: Pick<InventoryItem, "total" | "available">,
  newTotal: number,
): { total: number; available: number } {
  if (!Number.isInteger(newTotal) || newTotal < 0 || newTotal > MAX_STOCK) {
    throw new RuleViolationError("Enter a whole number of items.");
  }
  const available = item.available + (newTotal - item.total);
  if (available < 0) {
    throw new RuleViolationError(
      `${item.total - item.available} items are out on loan, so there cannot be fewer than that.`,
    );
  }
  return { total: newTotal, available };
}

/** Takes `quantity` out of the shelf (a hand-over); refuses when fewer are available. */
export function takeFromShelf(item: Pick<InventoryItem, "available">, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RuleViolationError("The quantity must be at least 1.");
  }
  if (quantity > item.available) {
    throw new RuleViolationError(`Only ${item.available} available.`);
  }
  return item.available - quantity;
}

/** Puts `quantity` back; never above `total`. */
export function putOnShelf(
  item: Pick<InventoryItem, "total" | "available">,
  quantity: number,
): number {
  return Math.min(item.total, item.available + quantity);
}

export const LOG_ACTIONS = [
  "added",
  "adjusted",
  "damaged",
  "retired",
  "handed_over",
  "returned",
] as const;
export type LogAction = (typeof LOG_ACTIONS)[number];

export interface InventoryLogEntry {
  readonly id: string;
  readonly itemId: string;
  readonly action: LogAction;
  /** Change of `available` (negative = taken out). */
  readonly change: number;
  readonly note: string | null;
  readonly by: string | null;
  readonly at: Date;
}

/** The log action a condition change deserves (no change = a plain adjustment). */
export const actionForCondition = (before: ItemCondition, after: ItemCondition): LogAction =>
  before !== after && after !== "good" ? (after === "damaged" ? "damaged" : "retired") : "adjusted";

/** A retired or hidden item leaves the public catalogue and keeps its history. */
export const isListed = (item: Pick<InventoryItem, "published" | "condition" | "deletedAt">) =>
  item.published && item.condition !== "retired" && item.deletedAt === null;

export interface PublicItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly image: FeaturedImage | null;
  readonly available: number;
  readonly condition: ItemCondition;
  readonly location: string;
}

export const toPublicItem = (i: InventoryItem): PublicItem => ({
  id: i.id,
  name: i.name,
  category: i.category,
  description: i.description,
  image: i.image,
  available: i.available,
  condition: i.condition,
  location: i.location,
});
