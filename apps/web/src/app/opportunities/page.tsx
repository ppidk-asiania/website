import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  filterBoard,
  OPPORTUNITY_TYPES,
  type OpportunityType,
} from "@website/domain/opportunities";
import { NewsCards } from "@/components/news-cards";
import { SubmitOnChangeSelect } from "@/components/submit-on-change-select";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { publicNews } from "@/server/news";
import { appliedStatuses, mentorshipLink, opportunitiesFor } from "@/server/opportunities";
import { getSignedInUser } from "@/server/session";
import { OpportunityList } from "./opportunity-list";

export const metadata: Metadata = { title: "Peluang · Opportunities" };
export const instant = false;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function OpportunitiesPage({ searchParams }: PageProps<"/opportunities">) {
  const params = await searchParams;
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  const [board, user, mentorship] = await Promise.all([
    opportunitiesFor("board"),
    getSignedInUser(),
    mentorshipLink(),
  ]);
  const applied = user ? await appliedStatuses(user.uid) : new Map<string, string>();
  const countries = [...new Set(board.map((o) => o.country))].sort();
  const type = OPPORTUNITY_TYPES.find((v): v is OpportunityType => v === one(params["type"]));
  const country = countries.find((c) => c === one(params["country"]));
  const items = filterBoard(board, { type: type ?? null, country: country ?? null });
  const guides = (await publicNews()).filter((n) => n.category === "career");
  const labels = t.opportunities;

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{labels.title}</h1>
      <p>{labels.intro}</p>
      <form action="/opportunities" method="get">
        <label>
          {labels.type}{" "}
          <SubmitOnChangeSelect className="ui-input" name="type" defaultValue={type ?? ""}>
            <option value="">{labels.allTypes}</option>
            {OPPORTUNITY_TYPES.map((v) => (
              <option key={v} value={v}>
                {labels.types[v]}
              </option>
            ))}
          </SubmitOnChangeSelect>
        </label>{" "}
        <label>
          {labels.country}{" "}
          <SubmitOnChangeSelect className="ui-input" name="country" defaultValue={country ?? ""}>
            <option value="">{labels.allCountries}</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SubmitOnChangeSelect>
        </label>
      </form>
      {mentorship ? (
        <p>
          <a className="ui-button" href={mentorship}>
            {labels.mentorship}
          </a>
        </p>
      ) : null}
      <OpportunityList
        items={items}
        labels={labels}
        empty={labels.empty}
        signedIn={user !== null}
        applied={applied}
      />
      <p>
        <a href="/opportunities/archive">{labels.archiveLink}</a>
      </p>
      <section aria-labelledby="career-guides">
        <h2 id="career-guides">{labels.guides}</h2>
        {guides.length === 0 ? (
          <p className="site-muted">{labels.noGuides}</p>
        ) : (
          <NewsCards items={guides} t={t} />
        )}
      </section>
    </main>
  );
}
