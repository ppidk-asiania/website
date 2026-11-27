import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { deviceLabel, hasTwoSignInMethods, signInUrl } from "@website/auth";
import { isProfileComplete } from "@website/domain/members";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { ownSignInMethods } from "@/server/passkeys";
import { ownProfile } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";
import { submissionsOf } from "@/server/submissions-wiring";
import { ownAccount } from "@/server/own-account-wiring";
import { certificatePickup, certificatePickupEnabled } from "@/server/verification-wiring";
import type { Submission } from "@/server/submissions";
import { SettingsShell } from "../settings-shell";
import { AccountPanel } from "./account-panel";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export const instant = false;

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
  if (!user) redirect(signInUrl("", "/settings/account"));
  const [methods, overview, mine, certificates, jar, request, profile] = await Promise.all([
    ownSignInMethods(user.uid),
    ownAccount().overview(user),
    submissionsOf()(user.uid),
    // switched off when its secrets are not set (e.g. a local .env): the page still works
    certificatePickupEnabled() ? certificatePickup().own(user) : null,
    cookies(),
    headers(),
    ownProfile().load(user),
  ]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const dictionary = DICTIONARIES[language];
  const t = dictionary.submissions;
  const a = dictionary.settingsAccount;
  const p = dictionary.profile;
  return (
    <SettingsShell d={dictionary} tab="account">
      {isProfileComplete(profile) ? null : (
        <p>
          <a href="/settings/profile">{p.linkLabel}</a> — {p.incomplete}
        </p>
      )}
      <AccountPanel
        t={a}
        language={language}
        overview={overview}
        deviceGuess={deviceLabel(request.get("user-agent"))}
        methodsNote={hasTwoSignInMethods(methods) ? a.twoMethods : a.needTwo}
      />
      <hr className="site-settings-rule" />
      <h2 className="site-settings-section-title">{t.title}</h2>
      {mine.length === 0 ? (
        <p className="site-settings-hint">{t.empty}</p>
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
      <h2 className="site-settings-section-title">{t.certificates}</h2>
      <p className="site-settings-hint">{t.certificatesHint}</p>
      {certificates === null ? (
        <p className="site-settings-hint">{t.certificatesOff}</p>
      ) : certificates.length === 0 ? (
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
    </SettingsShell>
  );
}
