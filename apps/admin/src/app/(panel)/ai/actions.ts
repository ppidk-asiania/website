"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { aiActions } from "@/server/wiring";

export async function saveAiSettingsAction(input: unknown) {
  const result = await aiActions().saveSettings(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/");
  return result;
}
