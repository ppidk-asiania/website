declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EntityId = Brand<string, "EntityId">;

export interface EntityMeta {
  readonly id: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export type Result<T, E extends string = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends string>(error: E): Result<never, E> => ({ ok: false, error });

export interface Clock {
  now(): Date;
}

export class ConcurrencyConflictError extends Error {
  override readonly name = "ConcurrencyConflictError";
}

export class RuleViolationError extends Error {
  override readonly name = "RuleViolationError";
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 120 && SLUG.test(slug);
}

/**
 * Official organisation name (DECISIONS s.112). Every place that prints the long name uses this.
 * Short names "PPI Dunia", "PPIDK Asiania" and "PPIDK Asia-Oseania" stay as they are.
 * The English wording is a proposal until the owner confirms it.
 */
export const ORGANISATION_NAME = {
  id: "PERHIMPUNAN PELAJAR INDONESIA DUNIA KAWASAN ASIA-OSEANIA",
  en: "Overseas Indonesian Students’ Association Alliance for Asia-Oceania Region",
} as const;

export * from "./files";
export * from "./images";
export * from "./money";
export * from "./time";
