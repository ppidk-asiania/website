import type { EntityMeta } from "../shared";

export interface Country extends EntityMeta {
  readonly code: string; // ISO 3166-1 alpha-2
  readonly name: string;
}

export interface Chapter extends EntityMeta {
  readonly slug: string;
  readonly name: string;
  readonly countryCode: string;
  readonly active: boolean;
}

const ISO_ALPHA2 = /^[A-Z]{2}$/;
export function isValidCountryCode(code: string): boolean {
  return ISO_ALPHA2.test(code);
}

export interface ChapterReader {
  listActive(): Promise<Chapter[]>;
  findBySlug(slug: string): Promise<Chapter | null>;
}
