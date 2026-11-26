"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { committeeActions, eventActions, eventRegistrationActions } from "@/server/wiring";

export async function saveEventAction(input: unknown) {
  const result = await eventActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function setEventPublishedAction(input: unknown) {
  const result = await eventActions().setPublished(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function removeEventAction(input: unknown) {
  const result = await eventActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function requestEventApprovalAction(input: unknown) {
  const result = await eventActions().requestApproval(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function approveEventAction(input: unknown) {
  const result = await eventActions().approve(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function rejectEventAction(input: unknown) {
  const result = await eventActions().reject(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function cancelEventAction(input: unknown) {
  const result = await eventActions().cancel(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function saveEventAfterAction(input: unknown) {
  const result = await eventActions().saveAfter(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function saveEventRegistrationAction(input: unknown) {
  const result = await eventRegistrationActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function createEventShortLinkAction(input: unknown) {
  const result = await eventRegistrationActions().shortLink(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function listEventRegistrantsAction(input: unknown) {
  return eventRegistrationActions().registrants(getPrincipal, getAuditContext)(input);
}

export async function saveEventFeeAction(input: unknown) {
  const result = await eventRegistrationActions().saveFee(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function verifyEventPaymentAction(input: unknown) {
  return eventRegistrationActions().verify(getPrincipal, getAuditContext)(input);
}

export async function rejectEventPaymentAction(input: unknown) {
  return eventRegistrationActions().reject(getPrincipal, getAuditContext)(input);
}

export async function loadCommitteeAction(input: unknown) {
  return committeeActions().load(getPrincipal, getAuditContext)(input);
}

export async function saveCommitteeAction(input: unknown) {
  return committeeActions().save(getPrincipal, getAuditContext)(input);
}

export async function findCommitteePeopleAction(input: unknown) {
  return committeeActions().findPeople(getPrincipal, getAuditContext)(input);
}

export async function listCommitteeApplicantsAction(input: unknown) {
  return committeeActions().applicants(getPrincipal, getAuditContext)(input);
}

export async function placeCommitteeApplicantAction(input: unknown) {
  return committeeActions().place(getPrincipal, getAuditContext)(input);
}
