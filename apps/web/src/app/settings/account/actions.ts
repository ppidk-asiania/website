"use server";

import { ownAccount } from "@/server/own-account-wiring";
import { getSignedInUser } from "@/server/session";

export async function requestEmailCodeAction(input: unknown) {
  return ownAccount().requestCode(await getSignedInUser(), input);
}

export async function confirmEmailCodeAction(input: unknown) {
  return ownAccount().confirmCode(await getSignedInUser(), input);
}

export async function disconnectGoogleAction() {
  return ownAccount().disconnectGoogle(await getSignedInUser());
}

export async function closeAccountAction(input: unknown) {
  return ownAccount().close(await getSignedInUser(), input);
}
