import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnUrl, signInUrl } from "@website/auth";
import { PRIVACY_POLICY_VERSION, studyStatus } from "@website/domain/members";
import { AppShell } from "@website/ui";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { activeChapters } from "@/server/chapters";
import { getAppUrls } from "@/server/env";
import { ownProfile, ownStudentProof } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";
import { GraduationForm } from "./graduation-form";
import { toFormValues } from "./form-values";
import { ProfileForm } from "./profile-form";
import { WhatsappLink } from "./whatsapp-link";
import { StudentProofForm } from "./student-proof-form";

export const metadata: Metadata = { title: "Member profile", robots: { index: false } };

export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ProfilePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/account/profile"));
  const [profile, proof, chapters, jar, params] = await Promise.all([
    ownProfile().load(user),
    ownStudentProof().summary(user),
    activeChapters(),
    cookies(),
    searchParams,
  ]);
  const t = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)].profile;
  const urls = getAppUrls();
  const allowed = [urls.WEB_URL, urls.ADMIN_URL, urls.SHOP_URL].filter(
    (url): url is string => url !== undefined,
  );
  const next = typeof params["next"] === "string" ? safeReturnUrl(params["next"], allowed) : null;
  return (
    <AppShell title={t.title}>
      <p>{t.intro}</p>
      {!user.emailVerified ? (
        <p role="alert">{t.verifyFirst}</p>
      ) : (
        <ProfileForm
          key={profile?.version ?? 0}
          t={t}
          initial={toFormValues(profile)}
          version={profile?.version ?? null}
          policyVersion={PRIVACY_POLICY_VERSION}
          chapters={chapters.map((c) => ({ countryCode: c.countryCode, name: c.name }))}
          next={next}
        />
      )}
      {profile && proof && (
        <>
          <h2>{t.proof.title}</h2>
          <StudentProofForm t={t.proof} current={proof} />
        </>
      )}
      {profile && (
        <>
          <h2>{t.whatsappTitle}</h2>
          <WhatsappLink t={t} verified={profile.whatsappVerifiedAt !== null} />
          <h2>{t.graduation}</h2>
          <p>
            {
              {
                student: t.graduationStudent,
                graduating: `${t.graduationGraduating} ${profile.graduation.on}.`,
                alumni: `${t.graduationAlumni} ${profile.graduation.on}.`,
              }[studyStatus(profile.graduation.on, new Date().toISOString().slice(0, 10))]
            }
          </p>
          <GraduationForm t={t} version={profile.version} graduatedOn={profile.graduation.on} />
        </>
      )}
    </AppShell>
  );
}
