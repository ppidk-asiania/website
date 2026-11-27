import type { PublicChapter } from "@website/domain/organizations";
import type { Dictionary } from "@/i18n/dictionaries";
import { SOCIAL_LINKS } from "@/components/social-links";

export function ChapterDetails({ chapter, t }: { chapter: PublicChapter; t: Dictionary["map"] }) {
  const photo = chapter.logo?.url ?? null;
  const socials = [
    ...(chapter.instagram
      ? [
          {
            label: t.detail.instagram,
            url: `https://instagram.com/${chapter.instagram.replace(/^@/, "")}`,
          },
        ]
      : []),
    ...chapter.socials,
  ];
  const chapterSocial = new Map(socials.map((social) => [social.label.toLowerCase(), social.url]));
  const socialHref = (name: string, fallback: string) =>
    chapterSocial.get(name.toLowerCase()) ?? fallback;
  return (
    <>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- Storage serves the logo; dims come from the DB row
        <img
          className="chapter__logo"
          src={photo}
          width={chapter.logo?.width}
          height={chapter.logo?.height}
          alt=""
        />
      )}
      {chapter.description && <p className="chapter__about">{chapter.description}</p>}
      {Boolean(chapter.contactName || chapter.role || chapter.email || chapter.phone) && (
        <div className="chapter__team">
          {chapter.contactName && <p className="chapter__person">{chapter.contactName}</p>}
          {chapter.role && (
            <p className="chapter__role">
              {chapter.role} {chapter.name}
            </p>
          )}
          {chapter.email && (
            <p className="chapter__line">
              {t.detail.email}:{" "}
              <a className="chapter__link" href={`mailto:${chapter.email}`}>
                {chapter.email}
              </a>
            </p>
          )}
          {chapter.phone && (
            <p className="chapter__line">
              {t.detail.phone}:{" "}
              <a className="chapter__link" href={`tel:${chapter.phone}`}>
                {chapter.phone}
              </a>
            </p>
          )}
        </div>
      )}
      <div className="chapter__org">{chapter.name}</div>
      <ul className="chapter__socials">
        {SOCIAL_LINKS.map((social) => (
          <li key={social.name}>
            <a
              href={socialHref(social.name, social.href)}
              aria-label={social.name}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d={social.path} />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
