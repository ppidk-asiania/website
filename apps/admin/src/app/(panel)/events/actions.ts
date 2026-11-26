"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { eventActions } from "@/server/wiring";

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
