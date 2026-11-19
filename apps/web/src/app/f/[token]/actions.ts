"use server";

import { submitPublicForm } from "@/server/forms-wiring";
import { getSignedInUser } from "@/server/session";

export async function submitFormAction(input: unknown) {
  return submitPublicForm()(await getSignedInUser(), input);
}
