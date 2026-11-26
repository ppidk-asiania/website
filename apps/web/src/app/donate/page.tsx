import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { donationChannels, supporters } from "@/server/donations";
import { getSignedInUser } from "@/server/session";
import { DonateForm } from "./donate-form";

export const metadata: Metadata = { title: "Donasi · Donate" };
export const instant = false;

export default async function DonatePage() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].donate;
  const user = await getSignedInUser();
  const [channels, wall] = await Promise.all([
    user ? donationChannels() : Promise.resolve([]),
    supporters(),
  ]);

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      {!user ? (
        <p>
          <a href={`/login?next=${encodeURIComponent("/donate")}`}>{t.signIn}</a>
        </p>
      ) : channels.length === 0 ? (
        <p>{t.noChannels}</p>
      ) : (
        <>
          {channels.map((c) => (
            <section key={c.id} aria-label={c.label}>
              <h2>{c.label}</h2>
              <p style={{ whiteSpace: "pre-line" }}>{c.details}</p>
              {c.image && (
                // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
                <img src={c.image.url} width={c.image.width} height={c.image.height} alt="" />
              )}
            </section>
          ))}
          <DonateForm channels={channels} labels={t} />
        </>
      )}
      <section aria-labelledby="supporters">
        <h2 id="supporters">{t.supporters}</h2>
        {wall.length === 0 ? (
          <p>{t.supportersEmpty}</p>
        ) : (
          <ul>
            {wall.map((s) => (
              <li key={s.id}>{s.name ?? t.anonymous}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
