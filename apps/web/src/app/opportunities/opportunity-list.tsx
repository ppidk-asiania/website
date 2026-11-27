import { sanitizeRichText } from "@website/security/html";
import type { PublicOpportunity } from "@website/domain/opportunities";
import type { Dictionary } from "@/i18n/dictionaries";
import { ApplyForm } from "./apply-form";

type Labels = Dictionary["opportunities"];

/** One list of postings, shared by the board and the archive. A past one is greyed and has no button. */
export function OpportunityList({
  items,
  labels,
  empty,
  signedIn = false,
  applied = new Map(),
}: {
  items: readonly PublicOpportunity[];
  labels: Labels;
  empty: string;
  signedIn?: boolean;
  /** Posting id → status of this account's application. */
  applied?: ReadonlyMap<string, string>;
}) {
  if (items.length === 0) return <p className="site-muted">{empty}</p>;
  return (
    <ul className="site-cards">
      {items.map((o) => (
        <li
          key={o.id}
          className="site-card"
          style={o.phase === "open" ? undefined : { opacity: 0.6 }}
        >
          {o.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- Storage serves a sized WebP
            <img className="site-card__image" src={o.image.thumbUrl} alt="" loading="lazy" />
          ) : null}
          <p className="site-card__type">{labels.types[o.type]}</p>
          <h3 className="site-card__title">{o.title}</h3>
          <p className="site-card__meta">
            {o.organization}
            <span aria-hidden="true">•</span>
            {[o.city, o.country].filter(Boolean).join(", ")}
          </p>
          <p className="site-card__meta">
            {labels.deadline}:{" "}
            {o.deadline === null
              ? labels.noDeadline
              : o.phase === "past"
                ? `${o.deadline} · ${labels.closedDeadline}`
                : o.deadline}
          </p>
          {o.description || o.requirements ? (
            <details>
              <summary>{labels.description}</summary>
              {o.description ? (
                <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(o.description) }} />
              ) : null}
              {o.requirements ? (
                <>
                  <h4>{labels.requirements}</h4>
                  <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(o.requirements) }} />
                </>
              ) : null}
            </details>
          ) : null}
          {o.apply && o.external ? (
            <p>
              <a
                className="ui-button"
                href={`/opportunities/${o.id}/apply`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {labels.apply}
              </a>{" "}
              <span className="site-muted">{labels.applyHint}</span>
            </p>
          ) : null}
          {o.apply && !o.external ? (
            applied.has(o.id) ? (
              <p>
                {labels.applied}:{" "}
                {labels.statuses[applied.get(o.id) as keyof typeof labels.statuses] ?? ""}
              </p>
            ) : signedIn ? (
              <details>
                <summary>{labels.applyHere}</summary>
                <ApplyForm id={o.id} labels={labels} />
              </details>
            ) : (
              <p>
                <a className="ui-button" href="/login?next=/opportunities">
                  {labels.signInToApply}
                </a>
              </p>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
