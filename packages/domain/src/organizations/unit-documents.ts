import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import type { EntityMeta } from "../shared";

export const MAX_UNIT_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Default total per unit; the cap can be changed in `settings/documents` (`unitCapMb`). */
export const DEFAULT_UNIT_CAP_BYTES = 200 * 1024 * 1024;
export const UNIT_DOCUMENT_RETENTION_DAYS = 30;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((b, i) => bytes[i] === b);
const ascii = (bytes: Uint8Array, from: number, text: string) =>
  [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));

/** Allowed extensions with the content type and the magic bytes that must match. */
const KINDS: Readonly<Record<string, { type: string; matches: (bytes: Uint8Array) => boolean }>> = {
  pdf: { type: "application/pdf", matches: (b) => ascii(b, 0, "%PDF-") },
  docx: {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: (b) => startsWith(b, ZIP),
  },
  xlsx: {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    matches: (b) => startsWith(b, ZIP),
  },
  pptx: {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    matches: (b) => startsWith(b, ZIP),
  },
  doc: { type: "application/msword", matches: (b) => startsWith(b, OLE) },
  xls: { type: "application/vnd.ms-excel", matches: (b) => startsWith(b, OLE) },
  ppt: { type: "application/vnd.ms-powerpoint", matches: (b) => startsWith(b, OLE) },
  png: { type: "image/png", matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  jpg: { type: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { type: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  webp: {
    type: "image/webp",
    matches: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP"),
  },
};

/** The extension to store when the name's extension is allowed and the bytes really are that kind. */
export function unitDocumentExtension(name: string, bytes: Uint8Array): string | null {
  const ext = /\.([A-Za-z0-9]{2,5})$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return Object.hasOwn(KINDS, ext) && KINDS[ext]?.matches(bytes) ? ext : null;
}

export interface UnitDocumentFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
}

export interface UnitDocument extends EntityMeta {
  readonly periodId: string;
  /** `null` = the period-level folder. */
  readonly orgUnitId: string | null;
  readonly folder: string;
  readonly title: string;
  readonly file: UnitDocumentFile;
  readonly uploadedBy: string;
}

export const unitDocumentPath = (periodId: string, uuid: string, ext: string) =>
  `unit-documents/${periodId}/${uuid}.${ext}`;

export const UnitDocumentMetaSchema = z
  .object({
    folder: safeText(80, { allowEmpty: true }),
    title: safeText(200).pipe(z.string().min(2, "Enter a title.")),
  })
  .strict();

export const UnitDocumentUpdateSchema = UnitDocumentMetaSchema.extend({
  id: safeId,
  version: z.number().int().min(1),
}).strict();

export interface UnitDocumentViewer {
  /** The period the server reads as active; a caller can never name it. */
  readonly activePeriodId: string | null;
  /** Units where the person holds an active seat. */
  readonly seatUnitIds: readonly string[];
  /** `documents.edit` (global). */
  readonly editor: boolean;
}

/** One rule for every list, open and write: who may read and who may write a folder. */
export function unitDocumentRights(
  viewer: UnitDocumentViewer,
  target: { periodId: string; orgUnitId: string | null },
): { read: boolean; write: boolean } {
  if (viewer.editor) return { read: true, write: true };
  if (viewer.activePeriodId === null || target.periodId !== viewer.activePeriodId) {
    return { read: false, write: false };
  }
  const write = target.orgUnitId !== null && viewer.seatUnitIds.includes(target.orgUnitId);
  return { read: write || viewer.seatUnitIds.length > 0, write };
}
