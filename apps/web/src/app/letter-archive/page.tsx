import type { Metadata } from "next";
import { cookies } from "next/headers";
import { archiveChip, parseArchiveQuery, type ArchiveQuery } from "@website/domain/documents";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { ARCHIVE_COOKIE } from "@/server/letter-archive";
import { letterArchive } from "@/server/letter-archive-wiring";
import { GuestBook } from "./guest-book";

export const metadata: Metadata = {
  title: "Arsip Surat",
  robots: { index: false, follow: false },
};
export const instant = false;

const href = (query: ArchiveQuery, change: Partial<ArchiveQuery>) => {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.typeId) params.set("type", next.typeId);
  if (next.year) params.set("year", String(next.year));
  if (next.page > 1) params.set("page", String(next.page));
  const text = params.toString();
  return text ? `/letter-archive?${text}` : "/letter-archive";
};

export default async function LetterArchivePage({ searchParams }: PageProps<"/letter-archive">) {
  const [params, jar] = await Promise.all([searchParams, cookies()]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].letterArchive;
  const query = parseArchiveQuery(params);
  const result = await letterArchive().list(jar.get(ARCHIVE_COOKIE)?.value, query);
  const day = (date: string) =>
    new Intl.DateTimeFormat(language === "en" ? "en-GB" : "id-ID", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      {result === null ? (
        <GuestBook labels={t} />
      ) : (
        <>
          <form className="ui-form site-filters" method="get" action="/letter-archive">
            <label className="ui-field">
              <span>{t.searchLabel}</span>
              <input className="ui-input" name="q" maxLength={100} defaultValue={query.q} />
            </label>
            <label className="ui-field">
              <span>{t.typeLabel}</span>
              <select className="ui-input" name="type" defaultValue={query.typeId ?? ""}>
                <option value="">{t.allTypes}</option>
                {result.types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {archiveChip(type.id, type.name).label} ({type.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span>{t.yearLabel}</span>
              <select className="ui-input" name="year" defaultValue={query.year ?? ""}>
                <option value="">{t.allYears}</option>
                {result.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <button className="ui-button" type="submit">
              {t.search}
            </button>
          </form>
          <p className="site-muted">
            {result.total} {t.total}
          </p>
          {result.entries.length === 0 && <p className="site-notice">{t.empty}</p>}
          <ul className="site-archive">
            {result.entries.map((entry) => {
              const chip = archiveChip(entry.typeId, entry.typeName);
              return (
                <li key={entry.code} className="site-archive__item">
                  <span className={`site-chip site-chip--${chip.tone}`}>{chip.label}</span>
                  <strong>{entry.subject}</strong>
                  <code>{entry.number}</code>
                  <span className="site-muted">
                    {entry.letterDate ? `${day(entry.letterDate)} · ` : ""}
                    {entry.unitName}
                  </span>
                  <a href={`/verify/${entry.code}`}>{t.check}</a>
                </li>
              );
            })}
          </ul>
          <nav className="site-pager" aria-label={t.page}>
            {result.page > 1 && (
              <a className="ui-button" href={href(query, { page: result.page - 1 })}>
                {t.previous}
              </a>
            )}
            <span>
              {t.page} {result.page} / {result.pages}
            </span>
            {result.page < result.pages && (
              <a className="ui-button" href={href(query, { page: result.page + 1 })}>
                {t.next}
              </a>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
