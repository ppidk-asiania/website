"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { donationActions } from "@/server/wiring";

const refreshed = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/finance/donations");
  return result;
};

export async function saveDonationChannelAction(input: unknown) {
  return refreshed(await donationActions().saveChannel(getPrincipal, getAuditContext)(input));
}

export async function verifyDonationAction(input: unknown) {
  return refreshed(await donationActions().verify(getPrincipal, getAuditContext)(input));
}

export async function rejectDonationAction(input: unknown) {
  return refreshed(await donationActions().reject(getPrincipal, getAuditContext)(input));
}
