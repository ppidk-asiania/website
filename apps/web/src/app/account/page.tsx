import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasTwoSignInMethods, signInUrl } from "@website/auth";
import { isProfileComplete } from "@website/domain/members";
import { AppShell } from "@website/ui";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { ownSignInMethods } from "@/server/passkeys";
import { ownProfile } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";
import { submissionsOf } from "@/server/submissions-wiring";
import { certificatePickup } from "@/server/verification-wiring";
import type { Submission } from "@/server/submissions";
import { AccountActions } from "./account-actions";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export const instant = false;

const PROVIDER_LABEL: Record<string, string> = {
  "google.com": "Google",
  password: "E-mail and password",
};

type Dictionary = (typeof DICTIONARIES)[keyof typeof DICTIONARIES];
const word = (words: object, key: string) => (words as Record<string, string>)[key] ?? key;

/** The words of one row's state: each kind keeps its states in the dictionary of its own page. */
function stateText(d: Dictionary, row: Submission): string {
  switch (row.kind) {
    case "event":
      return word(d.events.statuses, row.state);
    case "recruitment":
      return `${word(d.recruitment.statuses, row.state)}${
        row.next ? ` · ${word(d.recruitment.actions, row.next)}` : ""
      }`;
    case "opportunity":
      return word(d.opportunities.statuses, row.state);
    case "loan":
      return word(d.inventory.mine.states, row.state);
    case "donation":
      return word(d.submissions.donationStates, row.state);
    case "form":
      return d.submissions.sent;
  }
}

export default async function AccountPage() {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/account"));
  const [methods, mine, certificates, jar, profile] = await Promise.all([
    ownSignInMethods(user.uid),
    submissionsOf()(user.uid),
    certificatePickup().own(user),
    cookies(),
    ownProfile().load(user),
  ]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const dictionary = DICTIONARIES[language];
  const t = dictionary.submissions;
  const p = DICTIONARIES[language].profile;
  const s = DICTIONARIES[language].signature;
  return (
    <AppShell title="Your account">
      <p>Signed in as {user.email ?? "your account"}.</p>
      {!user.emailVerified && <p>Please verify your email address — check your inbox.</p>}
      <p>
        <a href="/account/profile">{p.linkLabel}</a>
        {isProfileComplete(profile) ? null : ` — ${p.incomplete}`}
      </p>
      <p>
        <a href="/account/signature">{s.linkLabel}</a>
      </p>
      <h2>Sign-in methods</h2>
      <ul>
        {methods.providers.map((provider) => (
          <li key={provider}>{PROVIDER_LABEL[provider] ?? provider}</li>
        ))}
        <li>Passkeys: {methods.passkeys}</li>
        <li>Two-step verification: {methods.mfaFactors > 0 ? "on" : "off"}</li>
      </ul>
      <p>
        {hasTwoSignInMethods(methods)
          ? "You have two sign-in methods, as staff roles require."
          : "Staff roles need two sign-in methods: add a passkey below (or turn on two-step verification)."}
      </p>
      <AccountActions />
      <h2>{t.title}</h2>
      {mine.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <ul>
          {mine.map((row) => (
            <li key={`${row.kind}:${row.id}`}>
              {t.kinds[row.kind]}: {row.href ? <a href={row.href}>{row.title}</a> : row.title} —{" "}
              {stateText(dictionary, row)}
              {row.detail ? ` · ${row.detail}` : ""} · {row.at.toLocaleDateString(language)}
              {row.ticketHref ? (
                <>
                  {" · "}
                  <a href={row.ticketHref}>{t.ticket}</a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <h2>{t.certificates}</h2>
      <p className="site-muted">{t.certificatesHint}</p>
      {certificates.length === 0 ? (
        <p>{t.certificatesEmpty}</p>
      ) : (
        <ul>
          {certificates.map((c) => (
            <li key={c.number + c.activity}>
              {c.activity}
              {c.number ? ` · ${c.number}` : ""} —{" "}
              {c.href ? <a href={c.href}>{t.download}</a> : t.cancelled}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
