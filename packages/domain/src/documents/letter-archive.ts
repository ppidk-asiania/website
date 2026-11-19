import { z } from "zod";
import { safeText } from "@website/security/validation";
import { NewsletterEmailSchema } from "../newsletter";

/** Signed pass in a cookie: the archive opens for an hour after the guest book. */
export const ARCHIVE_PASS_PURPOSE = "archive";
export const ARCHIVE_PASS_MS = 60 * 60 * 1000;
/** Guest rows are personal data: the cron job `expire` deletes them after a year. */
export const ARCHIVE_GUEST_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const ARCHIVE_PAGE_SIZE = 20;
const MAX_QUERY = 100;

export const ArchiveGuestSchema = z
  .object({
    name: safeText(120),
    email: NewsletterEmailSchema,
    institution: safeText(160),
    captcha: z.string().max(4000),
  })
  .strict();
export type ArchiveGuestInput = z.infer<typeof ArchiveGuestSchema>;

/** What the public list may show of an issued letter: never the recipient, body or file. */
export interface ArchiveEntry {
  readonly code: string;
  readonly number: string;
  readonly letterDate: string | null;
  readonly subject: string;
  readonly typeId: string;
  readonly typeName: string;
  readonly unitName: string;
}
export interface ArchiveRow extends ArchiveEntry {
  readonly issuedAt: Date;
}
export interface ArchiveQuery {
  readonly q: string;
  readonly typeId: string | null;
  readonly year: number | null;
  readonly page: number;
}
export interface ArchiveResult {
  readonly entries: readonly ArchiveEntry[];
  readonly total: number;
  readonly page: number;
  readonly pages: number;
  /** Types with their count among the rows matching the search and year (before the type filter). */
  readonly types: readonly { id: string; name: string; count: number }[];
  readonly years: readonly number[];
}

type Params = Readonly<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export function parseArchiveQuery(params: Params): ArchiveQuery {
  const year = Number(first(params["year"]));
  const page = Number(first(params["page"]));
  const typeId = first(params["type"]).trim();
  return {
    q: first(params["q"]).trim().slice(0, MAX_QUERY),
    typeId: /^[A-Za-z0-9_-]{1,80}$/.test(typeId) ? typeId : null,
    year: Number.isInteger(year) && year >= 2000 && year <= 2999 ? year : null,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

const yearOf = (row: ArchiveRow) =>
  Number(row.letterDate?.slice(0, 4) ?? row.issuedAt.getUTCFullYear());

/** Rows must be newest first; the page is clamped to the last one. */
export function searchArchive(rows: readonly ArchiveRow[], query: ArchiveQuery): ArchiveResult {
  const needle = query.q.toLowerCase();
  const matching = rows.filter(
    (row) =>
      (query.year === null || yearOf(row) === query.year) &&
      (needle === "" ||
        row.number.toLowerCase().includes(needle) ||
        row.subject.toLowerCase().includes(needle)),
  );
  const counts = new Map<string, { id: string; name: string; count: number }>();
  for (const row of matching) {
    const type = counts.get(row.typeId) ?? { id: row.typeId, name: row.typeName, count: 0 };
    counts.set(row.typeId, { ...type, count: type.count + 1 });
  }
  const shown = matching.filter((row) => query.typeId === null || row.typeId === query.typeId);
  const pages = Math.max(1, Math.ceil(shown.length / ARCHIVE_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    entries: shown.slice((page - 1) * ARCHIVE_PAGE_SIZE, page * ARCHIVE_PAGE_SIZE).map(toEntry),
    total: shown.length,
    page,
    pages,
    types: [...counts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    years: [...new Set(rows.map(yearOf))].sort((a, b) => b - a),
  };
}

const toEntry = ({ issuedAt: _issuedAt, ...entry }: ArchiveRow): ArchiveEntry => entry;

/** Type chip: the name without a leading "Surat" and one of six fixed colours per type. */
export function archiveChip(typeId: string, typeName: string): { label: string; tone: number } {
  const label = typeName.replace(/^surat\s+/i, "").trim() || typeName;
  return { label, tone: [...typeId].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 6 };
}
