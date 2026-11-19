import { detectImageType, isPdf } from "../shared";
import type { MemberProfile } from "./profile";
import { studyStatus } from "./verification";

/**
 * Proof of student status (DEC-21): a main document that states active status (certificate of
 * enrolment, official transcript, LoA/CoE) and an optional student card. Stored on the member
 * profile; no verification status, only a reviewer note (`proofReview`).
 */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export const PROOF_FILES = ["main", "supporting"] as const;
export type ProofFileKind = (typeof PROOF_FILES)[number];

export type ProofFileType = "pdf" | "jpeg" | "png" | "webp";
export interface ProofFile {
  readonly path: string;
  readonly type: ProofFileType;
}

export interface StudentProof {
  readonly main: ProofFile;
  readonly supporting: ProofFile | null;
  readonly confirmedActive: boolean;
  readonly uploadedAt: Date;
}

export type ProofReviewState = "ok" | "fix" | "fixed";
export interface ProofReview {
  readonly state: ProofReviewState;
  readonly note: string;
  readonly by: string | null;
  readonly at: Date;
}

export interface ProofState {
  readonly studentProof: StudentProof | null;
  readonly proofReview: ProofReview | null;
}

export const PROOF_CONTENT_TYPES: Readonly<Record<ProofFileType, string>> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** By the first bytes, never by the name or the declared type. */
export function detectProofType(bytes: Uint8Array): ProofFileType | null {
  if (isPdf(bytes)) return "pdf";
  const image = detectImageType(bytes);
  return image && (image.slice("image/".length) as ProofFileType);
}

export const studentProofPath = (
  uid: string,
  file: ProofFileKind,
  type: ProofFileType,
  uuid: string,
) =>
  `members/proofs/${uid}/${file}_${uuid.replace(/-/g, "").slice(0, 8)}.${type === "jpeg" ? "jpg" : type}`;

/** Alumni are never asked; a student (or one graduating soon) needs a main file. */
export const proofSatisfied = (
  profile: Pick<MemberProfile, "graduation" | "studentProof"> | null,
  today: string,
): boolean =>
  profile !== null &&
  (studyStatus(profile.graduation.on, today) === "alumni" || Boolean(profile.studentProof?.main));

/** One coloured mark in the applicants list: ok, fix asked, fixed, or not checked. */
export type ProofMark = ProofReviewState | "none";
export const proofMark = (profile: Pick<MemberProfile, "proofReview"> | null): ProofMark =>
  profile?.proofReview?.state ?? "none";

/** A new upload answers a fix request ("fixed"); a new main file voids an earlier "ok". */
export function reviewAfterUpload(
  review: ProofReview | null | undefined,
  file: ProofFileKind,
  now: Date,
): ProofReview | null {
  if (review?.state === "fix") return { ...review, state: "fixed", at: now };
  if (review?.state === "ok" && file === "main") return null;
  return review ?? null;
}
