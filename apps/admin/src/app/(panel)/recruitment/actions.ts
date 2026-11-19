"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import {
  analysisActions,
  applicationActions,
  exportLog,
  interviewActions,
  proofActions,
  recruitmentActions,
} from "@/server/wiring";

export async function saveRecruitmentAction(input: unknown) {
  const result = await recruitmentActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/recruitment");
  return result;
}

export async function setRecruitmentPublishedAction(input: unknown) {
  const result = await recruitmentActions().setPublished(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/recruitment");
  return result;
}

export async function saveInterviewRubricAction(input: unknown) {
  const result = await recruitmentActions().saveRubric(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/recruitment", "layout");
  return result;
}

export async function removeRecruitmentAction(input: unknown) {
  const result = await recruitmentActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/recruitment");
  return result;
}

const queued = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/recruitment", "layout");
  return result;
};

export async function requestRevisionAction(input: unknown) {
  return queued(await applicationActions().requestRevision(getPrincipal, getAuditContext)(input));
}

export async function failApplicationAction(input: unknown) {
  return queued(await applicationActions().fail(getPrincipal, getAuditContext)(input));
}

export async function passApplicationAction(input: unknown) {
  return queued(await applicationActions().pass(getPrincipal, getAuditContext)(input));
}

export async function rejectApplicationAction(input: unknown) {
  return queued(await applicationActions().reject(getPrincipal, getAuditContext)(input));
}

export async function offerApplicationAction(input: unknown) {
  return queued(await applicationActions().offer(getPrincipal, getAuditContext)(input));
}

export async function approvePlacementAction(input: unknown) {
  return queued(await applicationActions().approve(getPrincipal, getAuditContext)(input));
}

export async function returnPactAction(input: unknown) {
  return queued(await applicationActions().returnPact(getPrincipal, getAuditContext)(input));
}

export async function ratifyApplicationAction(input: unknown) {
  return queued(await applicationActions().ratify(getPrincipal, getAuditContext)(input));
}

export async function applicationFileUrlAction(input: unknown) {
  return applicationActions().fileUrl(getPrincipal, getAuditContext)(input);
}

export async function createInterviewPlanAction(input: unknown) {
  return queued(await interviewActions().createPlan(getPrincipal, getAuditContext)(input));
}

export async function createMyInterviewTimesAction(input: unknown) {
  return queued(await interviewActions().createMine(getPrincipal, getAuditContext)(input));
}

export async function updateInterviewSlotAction(input: unknown) {
  return queued(await interviewActions().updateSlot(getPrincipal, getAuditContext)(input));
}

export async function cancelInterviewSlotAction(input: unknown) {
  return queued(await interviewActions().cancelSlot(getPrincipal, getAuditContext)(input));
}

export async function recordAttendanceAction(input: unknown) {
  return queued(await interviewActions().markAttendance(getPrincipal, getAuditContext)(input));
}

export async function saveAssessmentAction(input: unknown) {
  return queued(await interviewActions().saveAssessment(getPrincipal, getAuditContext)(input));
}

export async function removeInterviewSlotAction(input: unknown) {
  return queued(await interviewActions().removeSlot(getPrincipal, getAuditContext)(input));
}

export async function logApplicantsExportAction(input: unknown) {
  return exportLog().applicants(getPrincipal, getAuditContext)(input);
}

export async function proofFileUrlAction(input: unknown) {
  return proofActions().fileUrl(getPrincipal, getAuditContext)(input);
}

export async function reviewProofAction(input: unknown) {
  return queued(await proofActions().review(getPrincipal, getAuditContext)(input));
}

export async function queueAnalysisAction(input: unknown) {
  return queued(await analysisActions().queue(getPrincipal, getAuditContext)(input));
}

export async function checkProofAction(input: unknown) {
  return queued(await analysisActions().checkProof(getPrincipal, getAuditContext)(input));
}
