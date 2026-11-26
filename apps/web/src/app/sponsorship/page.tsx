import type { Metadata } from "next";
import { cookies } from "next/headers";
import { groupByTier } from "@website/domain/organizations";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventDate } from "@/lib/event-time";
import { publicSponsors, sponsorshipReach } from "@/server/sponsors";

export const metadata: Metadata = { title: "Sponsor dan Kemitraan · Sponsors and partners" };
export const instant = false;

export default async function SponsorshipPage() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].sponsorship;
  const { sponsors, period } = await publicSponsors();
  const reach = await sponsorshipReach(period);
  const tiers = groupByTier(sponsors);

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      <p>{t.workWithUs}</p>
      {tiers.length === 0 ? <p>{t.empty}</p> : null}
      {tiers.map(({ tier, sponsors: inTier }) => (
        <section key={tier}>
          <h2>{t.tiers[tier]}</h2>
          <ul className="home-logos__list">
            {inTier.map((s) => (
              <li key={s.id} className="home-logos__item">
                {s.link ? (
                  <a href={s.link} target="_blank" rel="noopener noreferrer">
                    {s.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
                      <img
                        className="home-logos__mark"
                        src={s.logo.thumbUrl}
                        alt={s.name}
                        loading="lazy"
                      />
                    ) : (
                      s.name
                    )}
                  </a>
                ) : s.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
                  <img
                    className="home-logos__mark"
                    src={s.logo.thumbUrl}
                    alt={s.name}
                    loading="lazy"
                  />
                ) : (
                  s.name
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h2>{t.reachTitle}</h2>
        {reach.length === 0 ? (
          <p>{t.reachEmpty}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">{t.event}</th>
                <th scope="col">{t.date}</th>
                <th scope="col">{t.attendance}</th>
              </tr>
            </thead>
            <tbody>
              {reach.map((row) => (
                <tr key={row.slug}>
                  <td>
                    <a href={`/events/${row.slug}`}>{row.title}</a>
                  </td>
                  <td>{formatEventDate(row.startsAt, row.timezone)}</td>
                  <td>{row.attendance ?? t.unknown}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
