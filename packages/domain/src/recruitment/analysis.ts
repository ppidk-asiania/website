import { z } from "zod";

/** AI analysis of an application and the proof check (step 11.9). Results are notes, never a score. */
export const MAX_ANALYSIS_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ANALYSIS_TOTAL_BYTES = 20 * 1024 * 1024;
export const ANALYSIS_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export interface AnalysisFileRef {
  readonly label: string;
  readonly path: string;
  readonly contentType: string;
  readonly size: number;
}
export interface SkippedFile {
  readonly label: string;
  readonly reason: string;
}

/** What the model may receive: a file of an allowed type, up to 5 MB, 20 MB in all. The rest is listed. */
export function pickFiles(refs: readonly AnalysisFileRef[]): {
  files: AnalysisFileRef[];
  skipped: SkippedFile[];
} {
  const files: AnalysisFileRef[] = [];
  const skipped: SkippedFile[] = [];
  let total = 0;
  for (const ref of refs) {
    const reason = !(ANALYSIS_FILE_TYPES as readonly string[]).includes(ref.contentType)
      ? "file type not accepted"
      : ref.size > MAX_ANALYSIS_FILE_BYTES
        ? "file over 5 MB"
        : total + ref.size > MAX_ANALYSIS_TOTAL_BYTES
          ? "total over 20 MB"
          : null;
    if (reason) skipped.push({ label: ref.label, reason });
    else {
      files.push(ref);
      total += ref.size;
    }
  }
  return { files, skipped };
}

export const AnalysisOutputSchema = z.object({
  summary: z.string().max(4000),
  units: z.array(
    z.object({
      orgUnitId: z.string().max(128),
      supporting: z.array(z.string().max(500)).max(10),
      questions: z.array(z.string().max(500)).max(10),
    }),
  ),
  checks: z.array(z.string().max(500)).max(20),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export const ANALYSIS_STATUSES = ["queued", "running", "done", "failed"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export interface ApplicationAnalysis {
  readonly id: string;
  readonly applicationId: string;
  readonly status: AnalysisStatus;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly result: AnalysisOutput | null;
  readonly skipped: readonly SkippedFile[];
  readonly error: string | null;
}

const verdict = z.enum(["match", "differs", "unreadable"]);
export const ProofCheckOutputSchema = z.object({
  fields: z.object({
    name: verdict,
    campus: verdict,
    level: verdict,
    programme: verdict,
    entryYear: verdict,
    chapter: verdict,
  }),
  activeStatus: z.enum(["yes", "no", "unreadable"]),
});
export type ProofCheckOutput = z.infer<typeof ProofCheckOutputSchema>;

export interface ProofCheck {
  readonly id: string;
  readonly uid: string;
  readonly by: string;
  readonly at: Date;
  readonly result: ProofCheckOutput;
}
