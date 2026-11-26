import { cookies } from "next/headers";
import { Suspense } from "react";
import { Highlights } from "@/components/highlights";
import { NewsletterField } from "@/components/newsletter-field";
import { PpiSlider } from "@/components/ppi-slider";
import { HomeCardsSkeleton, LinesSkeleton } from "@/components/site-skeleton";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { publicEvents } from "@/server/events";
import { publicNews } from "@/server/news";
import { publicSponsors } from "@/server/sponsors";
import { logger } from "@/server/session";

interface FeaturedCard {
  title: string;
  desc: string;
  href: string;
}

/** The sponsors of the active period, from the directory; nothing is shown while there are none. */
async function SponsorStrip() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const { sponsors } = await publicSponsors().catch((error: unknown) => {
    logger().error("home_sponsors_failed", { error: String(error) });
    return { sponsors: [] };
  });
  if (sponsors.length === 0) return null;
  return (
    <section className="home-logos" aria-label={DICTIONARIES[language].home.sponsorLabel}>
      <ol className="home-logos__list">
        {sponsors.map((s) => (
          <li key={s.id} className="home-logos__item">
            <a href="/sponsorship">
              {s.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
                <img
                  className="home-logos__mark"
                  src={s.logo.thumbUrl}
                  alt={s.name}
                  loading="lazy"
                />
              ) : (
                <span className="home-logos__mark home-logos__mark--text">{s.name}</span>
              )}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function LatestEvents() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const events = await publicEvents().catch((error: unknown) => {
    logger().error("home_latest_events_failed", { error: String(error) });
    return [];
  });
  const cards: FeaturedCard[] = events.slice(0, 3).map((e) => ({
    title: e.title,
    desc: e.description,
    href: `/events/${e.slug}`,
  }));
  if (cards.length === 0) {
    cards.push(...t.home.fallbackEvents.map((f) => ({ ...f, href: "/events" })));
  }
  return (
    <section className="home-section">
      <h2>{t.home.eventsHeading}</h2>
      <ul className="home-cards">
        {cards.map((card) => (
          <li key={card.href + card.title} className="home-card">
            <h3>
              <a href={card.href}>{card.title}</a>
            </h3>
            <p>{card.desc}</p>
            <a className="home-card__action" href={card.href}>
              {t.home.register}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function LatestNews() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const news = await publicNews().catch((error: unknown) => {
    logger().error("home_latest_news_failed", { error: String(error) });
    return [];
  });
  const cards: FeaturedCard[] = news.slice(0, 3).map((n) => ({
    title: n.title,
    desc: n.summary,
    href: `/news/${n.slug}`,
  }));
  if (cards.length === 0) {
    cards.push(...t.home.fallbackNews.map((f) => ({ ...f, href: "/news" })));
  }
  return (
    <section className="home-section">
      <h2>{t.home.newsHeading}</h2>
      <ul className="home-cards">
        {cards.map((card) => (
          <li key={card.href + card.title} className="home-card">
            <h3>
              <a href={card.href}>{card.title}</a>
            </h3>
            <p>{card.desc}</p>
            <a className="home-card__action" href={card.href}>
              {t.home.readMore}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  return (
    <main>
      <Localized
        render={(t) => (
          <section className="home-hero">
            <h1>{t.home.heroTitle}</h1>
            <p>{t.home.heroSubtitle}</p>
            <a href="/about">{t.home.heroCta}</a>
          </section>
        )}
      />
      <Localized
        render={(t) => (
          <section className="home-welcome">
            <div className="home-welcome__inner">
              <div className="home-welcome__photo">
                {/* eslint-disable-next-line @next/next/no-img-element -- anonymous placeholder until the real photo exists */}
                <img
                  src="/home/welcome.svg"
                  alt=""
                  aria-hidden="true"
                  width={600}
                  height={800}
                  loading="lazy"
                />
              </div>
              <div className="home-welcome__text">
                <h2>{t.home.welcomeHeading}</h2>
                <div className="home-welcome__quote">
                  {t.home.welcomeQuote.split("\n\n").map((paragraph) => (
                    <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                  ))}
                </div>
                <p className="home-welcome__name">{t.home.welcomeName}</p>
              </div>
            </div>
          </section>
        )}
      />
      <Localized
        render={(t) => (
          <div className="ui-shell">
            <p>{t.home.tagline}</p>
            <section>
              <h2>{t.home.purposeHeading}</h2>
              <p>{t.home.purpose}</p>
            </section>
            <section>
              <h2>{t.newsletter.label}</h2>
              <NewsletterField t={t.newsletter} />
            </section>
          </div>
        )}
      />
      <Suspense fallback={<LinesSkeleton lines={3} />}>
        <Highlights />
      </Suspense>
      <Suspense fallback={<HomeCardsSkeleton />}>
        <LatestNews />
      </Suspense>
      <Suspense fallback={<HomeCardsSkeleton />}>
        <LatestEvents />
      </Suspense>
      <section className="home-blank" aria-hidden="true" />
      <Suspense fallback={<LinesSkeleton lines={1} />}>
        <SponsorStrip />
      </Suspense>
      <Localized render={(t) => <PpiSlider t={t.home.slider} />} />
      <Localized
        render={(t) => (
          <div className="ui-shell">
            <section className="site-notice">
              <h2>{t.home.googleHeading}</h2>
              <p>{t.home.google}</p>
              <a href="/privacy">{t.home.googleMore}</a>
            </section>
          </div>
        )}
      />
    </main>
  );
}
