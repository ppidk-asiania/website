"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { opportunityActions, opportunityApplicationActions } from "@/server/wiring";

type Name = "create" | "update" | "setStatus" | "remove";

/** Every change of a posting refreshes the admin list; the public board reads on its own cache. */
async function run(name: Name, input: unknown) {
  const result = await opportunityActions()[name](getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/opportunities");
  return result;
}

export const createOpportunityAction = (input: unknown) => run("create", input);
export const updateOpportunityAction = (input: unknown) => run("update", input);
export const setOpportunityStatusAction = (input: unknown) => run("setStatus", input);
export const deleteOpportunityAction = (input: unknown) => run("remove", input);

export async function setMentorshipFormAction(input: unknown) {
  const result = await opportunityActions().setMentorshipForm(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/opportunities");
  return result;
}

export async function reviewApplicationAction(input: unknown) {
  const result = await opportunityApplicationActions().review(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/opportunities");
  return result;
}

export async function deleteApplicationAction(input: unknown) {
  const result = await opportunityApplicationActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/opportunities");
  return result;
}
