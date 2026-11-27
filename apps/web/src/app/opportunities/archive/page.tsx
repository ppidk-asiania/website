import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { opportunitiesFor } from "@/server/opportunities";
import { OpportunityList } from "../opportunity-list";

export const metadata: Metadata = { title: "Arsip peluang · Opportunity archive" };
export const instant = false;

export default async function OpportunityArchivePage() {
  const labels =
    DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].opportunities;
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{labels.archiveTitle}</h1>
      <OpportunityList
        items={await opportunitiesFor("archive")}
        labels={labels}
        empty={labels.emptyArchive}
      />
      <p>
        <a href="/opportunities">{labels.boardLink}</a>
      </p>
    </main>
  );
}
