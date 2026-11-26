import { z } from "zod";
import { safeText } from "@website/security/validation";
import type { EntityMeta } from "../shared";

export const ORG_DOCUMENT_TYPES = ["statutes", "guideline", "other"] as const;
export type OrgDocumentType = (typeof ORG_DOCUMENT_TYPES)[number];

export const MAX_ORG_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Public PDFs live under one prefix, so a forged path cannot point at another public file. */
export const ORG_DOCUMENT_PATH = /^documents\/[A-Za-z0-9-]{8,64}\.pdf$/;
export const orgDocumentPath = (uuid: string) => `documents/${uuid}.pdf`;

export interface OrgDocumentFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
}

export interface OrgDocument extends EntityMeta {
  readonly type: OrgDocumentType;
  readonly title: string;
  readonly versionLabel: string;
  readonly date: string;
  readonly file: OrgDocumentFile | null;
  readonly link: string | null;
  readonly published: boolean;
}

const FileSchema = z
  .object({
    path: z.string().regex(ORG_DOCUMENT_PATH, "Upload the document again."),
    name: safeText(200),
    size: z.number().int().min(1).max(MAX_ORG_DOCUMENT_BYTES),
  })
  .strict();

/** An https link, or empty for none (stored as null). */
export const LinkSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Use an https:// link.")
  .transform((v) => v || null);

export const OrgDocumentInputSchema = z
  .object({
    type: z.enum(ORG_DOCUMENT_TYPES, { error: "Choose a document type." }),
    title: safeText(200).pipe(z.string().min(3, "Enter a title (at least 3 characters).")),
    versionLabel: safeText(60, { allowEmpty: true }),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of this version."),
    file: FileSchema.nullable(),
    link: LinkSchema,
    published: z.boolean(),
  })
  .strict()
  .refine((d) => (d.file === null) !== (d.link === null), {
    path: ["file"],
    message: "Give a PDF or a link, not both.",
  });
export type OrgDocumentInput = z.infer<typeof OrgDocumentInputSchema>;

export interface PublicOrgDocument {
  readonly id: string;
  readonly type: OrgDocumentType;
  readonly title: string;
  readonly versionLabel: string;
  readonly date: string;
  readonly href: string;
}

export interface OrgDocumentSeries {
  readonly title: string;
  readonly latest: PublicOrgDocument;
  readonly older: readonly PublicOrgDocument[];
}

/** One series per title inside a type: newest version first, older versions folded. */
export function groupOrgDocuments(
  docs: readonly PublicOrgDocument[],
): ReadonlyMap<OrgDocumentType, OrgDocumentSeries[]> {
  const byDate = [...docs].sort((a, b) => b.date.localeCompare(a.date));
  const result = new Map<OrgDocumentType, OrgDocumentSeries[]>();
  for (const type of ORG_DOCUMENT_TYPES) {
    const series = new Map<string, PublicOrgDocument[]>();
    for (const doc of byDate.filter((d) => d.type === type)) {
      series.set(doc.title, [...(series.get(doc.title) ?? []), doc]);
    }
    if (series.size > 0) {
      result.set(
        type,
        [...series].map(([title, [latest, ...older]]) => ({
          title,
          latest: latest as PublicOrgDocument,
          older,
        })),
      );
    }
  }
  return result;
}
