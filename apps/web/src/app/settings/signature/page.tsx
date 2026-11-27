import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signInUrl } from "@website/auth";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { ownSignature } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";
import { SettingsShell } from "../settings-shell";
import { SignatureForm } from "./signature-form";

export const metadata: Metadata = { title: "Signature", robots: { index: false } };

export const instant = false;

export default async function SignaturePage() {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/settings/signature"));
  const [current, jar] = await Promise.all([ownSignature().settings(user), cookies()]);
  const d = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)];
  const t = d.signature;
  return (
    <SettingsShell d={d} tab="signature">
      <p>{t.intro}</p>
      <SignatureForm t={t} current={current} />
    </SettingsShell>
  );
}
