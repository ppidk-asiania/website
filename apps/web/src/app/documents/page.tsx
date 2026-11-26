import type { Metadata } from "next";
import { cookies } from "next/headers";
import { groupOrgDocuments } from "@website/domain/organizations";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { publicOrgDocuments } from "@/server/org-documents";

export const metadata: Metadata = { title: "Dokumen Organisasi · Organisation documents" };
export const instant = false;

export default async function DocumentsPage() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].documents;
  const groups = groupOrgDocuments(await publicOrgDocuments());
  const day = (date: string) =>
    new Intl.DateTimeFormat(language === "en" ? "en-GB" : "id-ID", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  const label = (d: { versionLabel: string; date: string }) =>
    d.versionLabel ? `${d.versionLabel} · ${day(d.date)}` : day(d.date);

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      {groups.size === 0 ? <p>{t.empty}</p> : null}
      {[...groups].map(([type, series]) => (
        <section key={type}>
          <h2>{t.types[type]}</h2>
          <ul>
            {series.map((s) => (
              <li key={s.title}>
                <a href={s.latest.href} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>{" "}
                <small>{label(s.latest)}</small>
                {s.older.length > 0 ? (
                  <details>
                    <summary>{t.older}</summary>
                    <ul>
                      {s.older.map((d) => (
                        <li key={d.id}>
                          <a href={d.href} target="_blank" rel="noopener noreferrer">
                            {label(d)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
