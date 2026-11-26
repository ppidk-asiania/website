import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isRegistrationOpen } from "@website/domain/events";
import { isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { valuesFrom, EMPTY_VALUES } from "@/lib/form-answers";
import { eventRegistrationWizard } from "@/server/events";
import { getSignedInUser } from "@/server/session";
import { RegisterWizard } from "./register-wizard";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EventRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) notFound();
  const user = await getSignedInUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/events/${slug}/register`)}`);
  const wizard = await eventRegistrationWizard(slug, user);
  if (!wizard) notFound();
  // No questions: the event page registers with one click.
  if (!wizard.hasForm) redirect(`/events/${slug}`);
  const { event, view } = wizard;
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  const practice = query["practice"] === "1";
  const open = isRegistrationOpen(
    { ...event, published: true, deletedAt: null, publishAt: null },
    new Date(),
  );

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{event.title}</h1>
      {!view || view.state !== "open" || (!open && !practice) ? (
        <p className="site-notice">{t.events.closed}</p>
      ) : (
        <RegisterWizard
          slug={slug}
          version={view.form.version}
          questions={view.form.questions}
          modes={event.registration?.attendanceModes ?? []}
          practice={practice}
          profile={{
            name: view.mine?.name ?? "",
            email: view.mine?.email ?? "",
            fields: view.form.profileFields.map((field) => ({
              label: t.forms.profileFields[field],
              value: view.mine?.profile[field] ?? "",
            })),
          }}
          initial={
            view.mine?.answers ? valuesFrom(view.form.questions, view.mine.answers) : EMPTY_VALUES
          }
          labels={{ events: t.events, forms: t.forms }}
        />
      )}
    </main>
  );
}
