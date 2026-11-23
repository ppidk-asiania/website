"use server";

import { cookies, headers } from "next/headers";
import { letterArchive } from "@/server/letter-archive-wiring";
import { ARCHIVE_COOKIE } from "@/server/letter-archive";

export async function enterLetterArchiveAction(input: unknown) {
  const result = await letterArchive().enter(input, await headers());
  if (!result.ok) return result;
  (await cookies()).set(ARCHIVE_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/letter-archive",
    maxAge: result.maxAgeSeconds,
  });
  return { ok: true as const };
}
