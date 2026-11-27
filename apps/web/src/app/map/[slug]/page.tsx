import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { CHAPTER_MAP, countryName } from "@/lib/country-names";
import { activeChapters } from "@/server/chapters";
import { ChapterDetails } from "../chapter-details";

export const instant = false;

const find = async (slug: string) => {
  if (!isValidSlug(slug)) return null;
  return (await activeChapters()).find((c) => c.slug === slug) ?? null;
};

export async function generateMetadata({ params }: PageProps<"/map/[slug]">): Promise<Metadata> {
  const chapter = await find((await params).slug);
  if (!chapter) return {};
  return {
    title: countryName(
      chapter.countryCode,
      languageFrom((await cookies()).get(LANG_COOKIE)?.value),
    ),
    description: chapter.description || undefined,
  };
}

export default async function ChapterPage({ params }: PageProps<"/map/[slug]">) {
  const chapter = await find((await params).slug);
  if (!chapter) notFound();
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].map;
  const title = countryName(chapter.countryCode, language);
  return (
    <main className="site-lists site-lists--news">
      <div className="site-lists__inner">
        <h1 className="site-lists__title">{t.title}</h1>
        <p className="site-lists__tagline">{t.tagline}</p>
        <div className="chapter">
          {/* eslint-disable-next-line @next/next/no-img-element -- the shared NZ design map, sized by CSS */}
          <img className="chapter__image" src={CHAPTER_MAP} alt="" />
          <section className="chapter__panel">
            <a className="chapter__back" href="/map">
              ← {t.detail.back}
            </a>
            <h2 className="chapter__name">{title}</h2>
            <ChapterDetails chapter={chapter} t={t} />
          </section>
        </div>
      </div>
    </main>
  );
}
