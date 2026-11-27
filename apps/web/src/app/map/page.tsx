import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { LinesSkeleton } from "@/components/site-skeleton";
import type { PublicChapter } from "@website/domain/organizations";
import { DICTIONARIES, LANG_COOKIE, languageFrom, type Language } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { REGION_ORDER, chapterAlias, countryName } from "@/lib/country-names";
import { activeChapters } from "@/server/chapters";
import { ChapterDetails } from "./chapter-details";
import { ChapterMap } from "./chapter-map";

export const metadata: Metadata = { title: "Map" };

export default function MapPage() {
  return (
    <main className="site-lists site-lists--news">
      <div className="site-lists__inner">
        <Localized
          render={(t) => (
            <>
              <h1 className="site-lists__title">{t.map.title}</h1>
              <p className="site-lists__tagline">{t.map.tagline}</p>
            </>
          )}
        />
        <Suspense fallback={<LinesSkeleton lines={8} />}>
          <LocalizedMapPage />
        </Suspense>
      </div>
    </main>
  );
}

function MapRow({ chapter, language }: { chapter: PublicChapter; language: Language }) {
  const alias = chapterAlias(chapter.name);
  return (
    <li className="site-map__item">
      <button type="button" className="site-map__row" data-code={chapter.countryCode}>
        <span className="site-map__label">{countryName(chapter.countryCode, language)}</span>
        {alias && <span className="site-map__alias">{alias}</span>}
      </button>
    </li>
  );
}

async function LocalizedMapPage() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].map;
  const chapters = await activeChapters();
  const groups = REGION_ORDER.map((region) => ({
    region,
    rows: chapters
      .filter((c) => c.region === region)
      .map((c) => ({ chapter: c, country: countryName(c.countryCode, language) }))
      .sort(
        (a, b) =>
          a.country.localeCompare(b.country) || a.chapter.name.localeCompare(b.chapter.name),
      )
      .map((row) => row.chapter),
  })).filter((group) => group.rows.length > 0);
  const panels = Object.fromEntries(
    chapters.map((c) => [
      c.countryCode,
      chapters
        .filter((other) => other.countryCode === c.countryCode)
        .map((other) => <ChapterDetails key={other.slug} chapter={other} t={t} />),
    ]),
  );
  return (
    <ChapterMap
      language={language}
      labels={{
        map: t.label,
        close: t.close,
        noInfo: t.noInfo,
        zoomIn: t.zoomIn,
        zoomOut: t.zoomOut,
        reset: t.reset,
      }}
      panels={panels}
      list={
        chapters.length > 0 ? (
          <div className="site-map__groups">
            {groups.map(({ region, rows }) => (
              <section className="site-map__group" key={region}>
                <h3 className="site-map__group-title">{t.regions[region]}</h3>
                <ul className="site-map__list">
                  {rows.map((chapter) => (
                    <MapRow key={chapter.slug} chapter={chapter} language={language} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="site-muted">{t.empty}</p>
        )
      }
    />
  );
}
