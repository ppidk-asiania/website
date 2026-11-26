import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { SubmitOnChangeSelect } from "@/components/submit-on-change-select";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { countryName } from "@/lib/country-names";
import { universityDirectory } from "@/server/universities-directory";

export const metadata: Metadata = { title: "Universitas · Universities" };

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default function UniversitiesPage({ searchParams }: PageProps<"/universities">) {
  return (
    <Suspense fallback={null}>
      <Directory searchParams={searchParams} />
    </Suspense>
  );
}

async function Directory({ searchParams }: Pick<PageProps<"/universities">, "searchParams">) {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].universities;
  const params = await searchParams;
  const directory = await universityDirectory();
  const country = first(params["country"]).toUpperCase();
  const query = first(params["q"]).trim().slice(0, 100).toLowerCase();
  const shown = directory
    .filter((c) => country === "" || c.countryCode === country)
    .map((c) => ({
      ...c,
      name: countryName(c.countryCode, language),
      campuses: c.campuses.filter(
        (u) => query === "" || `${u.name} ${u.city ?? ""}`.toLowerCase().includes(query),
      ),
    }))
    .filter((c) => c.campuses.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, language));

  return (
    <main className="site-lists site-lists--news">
      <div className="site-lists__inner">
        <h1 className="site-lists__title">{t.title}</h1>
        <p className="site-lists__tagline">{t.intro}</p>
        <form className="site-lists__bar" action="/universities" method="get">
          <label className="site-lists__field">
            <span className="site-lists__field-label">{t.country}</span>
            <SubmitOnChangeSelect className="ui-input" name="country" defaultValue={country}>
              <option value="">{t.allCountries}</option>
              {directory.map((c) => (
                <option key={c.countryCode} value={c.countryCode}>
                  {countryName(c.countryCode, language)}
                </option>
              ))}
            </SubmitOnChangeSelect>
          </label>
          <label className="site-lists__field">
            <span className="site-lists__field-label">{t.search}</span>
            <input className="ui-input" name="q" maxLength={100} defaultValue={query} />
          </label>
          <button className="ui-button" type="submit">
            {t.searchButton}
          </button>
        </form>
        {shown.length === 0 ? <p>{t.empty}</p> : null}
        {shown.map((c) => (
          <section key={c.countryCode}>
            <h2>
              <a href={`/map/${c.slug}`}>{c.name}</a> <small>({c.campuses.length})</small>
            </h2>
            <ul>
              {c.campuses.map((u) => (
                <li key={u.id}>
                  {u.name}
                  {u.city ? <small> · {u.city}</small> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
