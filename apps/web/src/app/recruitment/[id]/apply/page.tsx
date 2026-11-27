import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInUrl } from "@website/auth";
import { isProfileComplete, PRIVACY_POLICY_VERSION, proofSatisfied } from "@website/domain/members";
import { applyStep, nextAction } from "@website/domain/recruitment";
import { toFormValues } from "@/app/settings/profile/form-values";
import { ProfileForm } from "@/app/settings/profile/profile-form";
import { StudentProofForm } from "@/app/settings/profile/student-proof-form";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { activeChapters } from "@/server/chapters";
import { ownProfile, ownStudentProof } from "@/server/profile-wiring";
import { recruitmentStore } from "@/server/recruitment-wiring";
import { getSignedInUser } from "@/server/session";
import { ApplyForm } from "./apply-form";
import { SubmitApplication } from "./submit-application";

export const metadata: Metadata = { title: "Application", robots: { index: false } };

export const instant = false;

export default async function ApplyPage({
  params,
  searchParams,
}: PageProps<"/recruitment/[id]/apply">) {
  const { id } = await params;
  const path = `/recruitment/${id}`;
  const apply = `${path}/apply`;
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", apply));
  const [r, profile, proof, chapters, jar, query] = await Promise.all([
    recruitmentStore().getPublished(id),
    ownProfile().load(user),
    ownStudentProof().summary(user),
    activeChapters(),
    cookies(),
    searchParams,
  ]);
  if (!r) notFound();
  const [application, questions] = await Promise.all([
    recruitmentStore().ownApplication(r.id, user.uid),
    recruitmentStore().questions(r),
  ]);
  const action = nextAction(r, application, new Date());
  if (action !== "start" && action !== "complete" && action !== "revise") redirect(path);
  const done = {
    profile: isProfileComplete(profile),
    proof: proofSatisfied(profile, new Date().toISOString().slice(0, 10)),
  };
  const step = applyStep(done, Number(query["step"]));
  const reach = applyStep(done, 4);
  const t = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)];
  const labels = t.recruitment.steps;
  const names = [labels.data, labels.proof, labels.application, labels.review];
  const choiceNames = (application?.choices ?? []).map(
    (c) => r.units.find((u) => u.orgUnitId === c)?.name ?? c,
  );

  return (
    <main className="ui-shell">
      <p>
        <a href={path}>← {t.recruitment.back}</a>
      </p>
      <h1 className="ui-shell-title">
        {t.recruitment.apply}: {r.title}
      </h1>
      <ol className="site-filters">
        {names.map((name, i) => (
          <li key={name} aria-current={step === i + 1 ? "step" : undefined}>
            {i + 1 <= reach ? <a href={`${apply}?step=${i + 1}`}>{name}</a> : name}
          </li>
        ))}
      </ol>
      {step === 1 &&
        (user.emailVerified ? (
          <ProfileForm
            key={profile?.version ?? 0}
            t={t.profile}
            initial={toFormValues(profile)}
            version={profile?.version ?? null}
            policyVersion={PRIVACY_POLICY_VERSION}
            chapters={chapters.map((c) => ({ countryCode: c.countryCode, name: c.name }))}
            next={`${apply}?step=2`}
          />
        ) : (
          <p role="alert">{t.profile.verifyFirst}</p>
        ))}
      {step === 1 && done.profile && <a href={`${apply}?step=2`}>{labels.next}</a>}
      {step === 2 && proof && (
        <>
          <StudentProofForm t={t.profile.proof} current={proof} />
          {done.proof ? (
            <a href={`${apply}?step=3`}>{labels.next}</a>
          ) : (
            <p role="alert">{t.recruitment.proofMissing}</p>
          )}
        </>
      )}
      {step === 3 && (
        <ApplyForm
          recruitmentId={r.id}
          maxChoices={r.maxChoices}
          units={r.units.map((u) => ({
            id: u.orgUnitId,
            name: u.name,
            portfolioRequired: u.portfolioRequired,
            seats: u.seats,
          }))}
          questions={questions}
          initial={{
            choices: [...(application?.choices ?? [])],
            choiceSeats: { ...(application?.choiceSeats ?? {}) },
            answers: { ...(application?.answers ?? {}) },
            portfolio: application?.portfolio?.name ?? null,
          }}
          labels={t.recruitment}
          formLabels={t.forms}
        />
      )}
      {step === 4 && (
        <div className="ui-form">
          <p>
            {labels.reviewIntro} <a href={`${apply}?step=3`}>{labels.application}</a>
          </p>
          <ul>
            <li>{profile?.fullName}</li>
            <li>{choiceNames.length > 0 ? choiceNames.join(", ") : t.recruitment.none}</li>
          </ul>
          <SubmitApplication recruitmentId={r.id} t={t.recruitment} />
        </div>
      )}
    </main>
  );
}
