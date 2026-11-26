import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlUniversityStore, type SqlUniversityStore } from "@website/db/sql";
import type { PublicChapter } from "@website/domain/organizations";
import { activeChapters } from "./chapters";
import { webDb } from "./db";

export interface DirectoryCountry {
  readonly countryCode: string;
  readonly slug: string;
  readonly campuses: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly city: string | null;
  }>;
}

/** Approved campuses of every active chapter's country; pending proposals never appear. */
export async function buildUniversityDirectory(
  chapters: readonly Pick<PublicChapter, "countryCode" | "slug">[],
  universities: Pick<SqlUniversityStore, "listApproved">,
): Promise<DirectoryCountry[]> {
  const lists = await Promise.all(
    chapters.map(async (c) => ({
      countryCode: c.countryCode,
      slug: c.slug,
      campuses: (await universities.listApproved(c.countryCode)).map((u) => ({
        id: u.id,
        name: u.name,
        city: u.city,
      })),
    })),
  );
  return lists.filter((c) => c.campuses.length > 0);
}

const store = lazyEnv(() => createSqlUniversityStore(webDb()));

export async function universityDirectory(): Promise<DirectoryCountry[]> {
  "use cache";
  cacheTag("universities");
  cacheLife("minutes");
  return buildUniversityDirectory(await activeChapters(), store());
}
