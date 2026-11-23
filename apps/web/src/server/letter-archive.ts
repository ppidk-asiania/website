import "server-only";
import type { SqlLetterArchive } from "@website/db/sql";
import {
  ARCHIVE_PASS_MS,
  ARCHIVE_PASS_PURPOSE,
  ArchiveGuestSchema,
  searchArchive,
  type ArchiveQuery,
  type ArchiveResult,
} from "@website/domain/documents";
import { clientIp, keyedHash, signLink, verifyLink } from "@website/security";

export const ARCHIVE_COOKIE = "letter_archive_pass";

export type EnterResult =
  | { readonly ok: true; readonly token: string; readonly maxAgeSeconds: number }
  | { readonly ok: false; readonly error: "details" | "captcha" };

export function createLetterArchive(deps: {
  readonly archive: Pick<SqlLetterArchive, "rows" | "recordGuest">;
  readonly captcha: (token: string) => Promise<boolean>;
  readonly secret: string;
  readonly now: () => Date;
}) {
  /** Guest book: stores the visitor (IP only as a keyed hash) and hands out a one-hour pass. */
  async function enter(input: unknown, headers: Headers): Promise<EnterResult> {
    const parsed = ArchiveGuestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "details" };
    const { captcha, ...guest } = parsed.data;
    if (!(await deps.captcha(captcha))) return { ok: false, error: "captcha" };
    const now = deps.now();
    await deps.archive.recordGuest(
      { ...guest, ipHash: keyedHash("letter-archive", clientIp(headers), deps.secret) },
      now,
    );
    const token = signLink(
      { purpose: ARCHIVE_PASS_PURPOSE },
      deps.secret,
      new Date(now.getTime() + ARCHIVE_PASS_MS),
    );
    return { ok: true, token, maxAgeSeconds: ARCHIVE_PASS_MS / 1000 };
  }

  /** The list, or null without a valid pass: nothing is read from the store before that. */
  async function list(
    token: string | undefined,
    query: ArchiveQuery,
  ): Promise<ArchiveResult | null> {
    const pass = token ? verifyLink(token, deps.secret, deps.now()) : null;
    if (pass?.["purpose"] !== ARCHIVE_PASS_PURPOSE) return null;
    return searchArchive(await deps.archive.rows(), query);
  }

  return { enter, list };
}
