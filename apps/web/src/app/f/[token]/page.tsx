import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ViewerTime } from "@/components/event-time";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { valuesFrom, EMPTY_VALUES } from "@/lib/form-answers";
import { isSignedInMode } from "@website/domain/forms";
import { publicFormByToken } from "@/server/forms-wiring";
import { getSignedInUser } from "@/server/session";
import { PublicFormClient } from "./public-form";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/f/[token]">): Promise<Metadata> {
  const view = await publicFormByToken()((await params).token, null);
  return view ? { title: view.form.title, robots: { index: false, follow: false } } : {};
}

export default async function PublicFormPage({ params }: PageProps<"/f/[token]">) {
  const { token } = await params;
  const user = await getSignedInUser();
  const view = await publicFormByToken()(token, user);
  if (!view) notFound();
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const { form, state, mine } = view;
  const signedInForm = isSignedInMode(form.respondents);
  const time = (date: Date) => (
    <>
      {formatEventTime(date, "UTC", language)} (UTC)
      <ViewerTime
        iso={date.toISOString()}
        eventZone="UTC"
        label={t.events.yourTime}
        language={language}
      />
    </>
  );

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{form.title}</h1>
      {form.description && <p className="site-pre">{form.description}</p>}
      {state === "upcoming" && form.opensAt ? (
        <p className="site-notice">
          {t.forms.upcoming} {time(form.opensAt)}
        </p>
      ) : state === "closed" ? (
        <p className="site-notice">{t.forms.closed}</p>
      ) : signedInForm && !user ? (
        <p className="site-notice">
          <a className="ui-button" href={`/login?next=${encodeURIComponent(`/f/${token}`)}`}>
            {t.forms.signIn}
          </a>
        </p>
      ) : form.respondents === "officers" && !mine?.officer ? (
        <p className="site-notice">{t.forms.officersOnly}</p>
      ) : (
        <>
          {form.closesAt && (
            <p className="site-muted">
              {t.forms.closesAt} {time(form.closesAt)}
            </p>
          )}
          <PublicFormClient
            token={token}
            version={form.version}
            questions={form.questions}
            labels={t.forms}
            askGuest={form.respondents === "guest"}
            signedIn={signedInForm}
            initial={mine?.answers ? valuesFrom(form.questions, mine.answers) : EMPTY_VALUES}
          >
            {mine && form.profileFields.length > 0 && (
              <section aria-labelledby="form-profile">
                <h2 id="form-profile">{t.forms.profileTitle}</h2>
                <dl>
                  {form.profileFields.map((field) => (
                    <div key={field}>
                      <dt className="site-muted">{t.forms.profileFields[field]}</dt>
                      <dd>{mine.profile[field] || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </PublicFormClient>
        </>
      )}
    </main>
  );
}
