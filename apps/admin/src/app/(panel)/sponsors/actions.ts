"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { sponsorActions } from "@/server/wiring";

export async function saveSponsorAction(input: unknown) {
  const result = await sponsorActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/sponsors");
  return result;
}

export async function deleteSponsorAction(input: unknown) {
  const result = await sponsorActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/sponsors");
  return result;
}
