"use server";

import { cookies } from "next/headers";
import { LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { registerForEventWithForm } from "@/server/events";
import { getSignedInUser } from "@/server/session";

export async function registerWithFormAction(input: unknown) {
  const [user, jar] = await Promise.all([getSignedInUser(), cookies()]);
  return registerForEventWithForm()(
    user && { uid: user.uid, email: user.email },
    input,
    languageFrom(jar.get(LANG_COOKIE)?.value),
  );
}
