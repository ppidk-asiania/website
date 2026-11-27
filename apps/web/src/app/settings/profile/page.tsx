import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { safeReturnUrl, signInUrl } from "@website/auth";
import { isProfileComplete, PRIVACY_POLICY_VERSION, studyStatus } from "@website/domain/members";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { activeChapters } from "@/server/chapters";
import { getAppUrls } from "@/server/env";
import { ownProfile, ownStudentProof } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";
import { FieldIcon } from "@/components/site-field-icon";
import { SettingsShell } from "../settings-shell";
import { GraduationForm } from "./graduation-form";
import { toFormValues } from "./form-values";
import { ProfileForm } from "./profile-form";
import { ProfileView } from "./profile-view";
import { WhatsappLink } from "./whatsapp-link";
import { StudentProofForm } from "./student-proof-form";

export const metadata: Metadata = { title: "Member profile", robots: { index: false } };

export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ProfilePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/settings/profile"));
  await connection(); // dates below are read at request time
  const [profile, proof, chapters, jar, params] = await Promise.all([
    ownProfile().load(user),
    ownStudentProof().summary(user),
    activeChapters(),
    cookies(),
    searchParams,
  ]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const d = DICTIONARIES[language];
  const t = d.profile;
  const urls = getAppUrls();
  const allowed = [urls.WEB_URL, urls.ADMIN_URL, urls.SHOP_URL].filter(
    (url): url is string => url !== undefined,
  );
  const next = typeof params["next"] === "string" ? safeReturnUrl(params["next"], allowed) : null;
  const chapterChoices = chapters.map((c) => ({ countryCode: c.countryCode, name: c.name }));
  const complete = profile !== null && isProfileComplete(profile);
  if (!complete || params["edit"] === "1" || next !== null) {
    return (
      <SettingsShell d={d} tab="profile" title={profile ? t.edit : undefined}>
        <p className="site-settings-hint">{t.intro}</p>
        {!user.emailVerified ? (
          <p role="alert">{t.verifyFirst}</p>
        ) : (
          <ProfileForm
            key={profile?.version ?? 0}
            t={t}
            initial={toFormValues(profile)}
            version={profile?.version ?? null}
            policyVersion={PRIVACY_POLICY_VERSION}
            chapters={chapterChoices}
            next={next ?? (complete ? "/settings/profile" : null)}
            backHref={complete ? "/settings/profile" : null}
          />
        )}
      </SettingsShell>
    );
  }
  const now = new Date();
  return (
    <SettingsShell
      d={d}
      tab="profile"
      action={
        <a className="site-settings-button" href="/settings/profile?edit=1">
          <FieldIcon name="pen" className="site-settings-icon" />
          {t.edit}
        </a>
      }
    >
      <ProfileView
        t={t}
        language={language}
        profile={profile}
        chapters={chapterChoices}
        now={now}
      />
      <hr className="site-settings-rule" />
      {proof && (
        <>
          <h2 className="site-settings-section-title">{t.proof.title}</h2>
          <StudentProofForm t={t.proof} current={proof} />
        </>
      )}
      <h2 className="site-settings-section-title">{t.whatsappTitle}</h2>
      <WhatsappLink t={t} verified={profile.whatsappVerifiedAt !== null} />
      <h2 className="site-settings-section-title">{t.graduation}</h2>
      <p>
        {
          {
            student: t.graduationStudent,
            graduating: `${t.graduationGraduating} ${profile.graduation.on}.`,
            alumni: `${t.graduationAlumni} ${profile.graduation.on}.`,
          }[studyStatus(profile.graduation.on, now.toISOString().slice(0, 10))]
        }
      </p>
      <GraduationForm t={t} version={profile.version} graduatedOn={profile.graduation.on} />
    </SettingsShell>
  );
}
