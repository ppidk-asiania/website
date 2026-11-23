import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatAttendTime } from "@/lib/attend-time";
import { formatEventTime } from "@/lib/event-time";
import { attendCard } from "@/server/attendance-wiring";
import { getSignedInUser } from "@/server/session";
import { AttendForm } from "./attend-form";

export async function AttendPage({ code }: { code: string }) {
  const [jar, user] = await Promise.all([cookies(), getSignedInUser()]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].attend;
  const back = code ? `/attend/${encodeURIComponent(code)}` : "/attend";
  const card = user && code ? await attendCard()(user.uid, code) : null;
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      {card && user ? (
        <section aria-label={card.title}>
          <h2>{card.title}</h2>
          <dl>
            <dt>{t.when}</dt>
            <dd>{formatEventTime(new Date(card.startsAt), card.zone, language)}</dd>
            {card.unit ? (
              <>
                <dt>{t.unit}</dt>
                <dd>{card.unit}</dd>
              </>
            ) : null}
            {card.place ? (
              <>
                <dt>{t.place}</dt>
                <dd>{card.place}</dd>
              </>
            ) : null}
            <dt>{t.recordedAs}</dt>
            <dd>{user.name ?? user.email}</dd>
          </dl>
        </section>
      ) : null}
      {card?.recordedAt ? (
        <p role="status" className="ui-message" data-tone="info">
          {t.done
            .replace("{title}", `"${card.title}"`)
            .replace("{time}", formatAttendTime(card.recordedAt, card.zone, language))}
        </p>
      ) : user ? (
        <AttendForm code={code} labels={t} language={language} />
      ) : (
        <p>
          <a className="ui-button" href={`/login?next=${encodeURIComponent(back)}`}>
            {t.signin}
          </a>
        </p>
      )}
    </main>
  );
}
