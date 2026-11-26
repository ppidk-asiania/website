import { describe, expect, it } from "vitest";
import { createSqlUniversityStore } from "@website/db/sql";
import { buildUniversityDirectory } from "../../apps/web/src/server/universities-directory";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlUniversityStore>[0];
const campus = (name: string, countryCode: string, status: string, city: string | null = null) => ({
  name,
  normalizedName: name.toLowerCase(),
  countryCode,
  city,
  website: null,
  aliases: [],
  aliasesNormalized: [],
  rorId: null,
  source: "manual",
  status,
  submittedBy: null,
  mergedInto: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  version: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
});

describe("University directory", () => {
  it("lists approved campuses by chapter country; pending and rejected stay hidden", async () => {
    const fake = fakeDb();
    const seed = async (id: string, data: ReturnType<typeof campus>) => {
      await fake.db.collection("universities").doc(id).set(data);
    };
    await seed("a", campus("Tokyo Univ", "JP", "approved", "Tokyo"));
    await seed("b", campus("Waseda", "JP", "pending"));
    await seed("c", campus("Old Univ", "JP", "rejected"));
    await seed("d", campus("Seoul Univ", "KR", "approved"));
    await seed("e", campus("Nobody Univ", "AU", "approved"));
    const store = createSqlUniversityStore(fake.db as unknown as Db);

    const directory = await buildUniversityDirectory(
      [
        { countryCode: "JP", slug: "jepang" },
        { countryCode: "KR", slug: "korea" },
        { countryCode: "NZ", slug: "selandia-baru" },
      ],
      store,
    );

    expect(directory.map((c) => [c.slug, c.campuses.map((u) => u.name)])).toEqual([
      ["jepang", ["Tokyo Univ"]],
      ["korea", ["Seoul Univ"]],
    ]);
    expect(JSON.stringify(directory)).not.toContain("Waseda");
  });
});
