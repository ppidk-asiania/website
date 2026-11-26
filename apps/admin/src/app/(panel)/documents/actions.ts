"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { unitDocumentActions } from "@/server/wiring";

export async function updateUnitDocumentAction(input: unknown) {
  const result = await unitDocumentActions().update(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/documents");
  return result;
}

export async function deleteUnitDocumentAction(input: unknown) {
  const result = await unitDocumentActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/documents");
  return result;
}
