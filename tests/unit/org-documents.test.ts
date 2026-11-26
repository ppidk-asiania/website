import { describe, expect, it } from "vitest";
import {
  groupOrgDocuments,
  OrgDocumentInputSchema,
  type PublicOrgDocument,
} from "@website/domain/organizations";

const file = { path: "documents/0b6f1c2e-aaaa.pdf", name: "ad-art.pdf", size: 1000 };
const base = {
  type: "statutes",
  title: "AD/ART",
  versionLabel: "",
  date: "2026-01-02",
  file,
  link: "",
  published: true,
};
const doc = (id: string, over: Partial<PublicOrgDocument>): PublicOrgDocument => ({
  id,
  type: "statutes",
  title: "AD/ART",
  versionLabel: "",
  date: "2026-01-01",
  href: `/files/documents/${id}.pdf`,
  ...over,
});

describe("OrgDocumentInputSchema", () => {
  it("takes a PDF or an https link, never both and never none", () => {
    expect(OrgDocumentInputSchema.safeParse(base).success).toBe(true);
    expect(
      OrgDocumentInputSchema.safeParse({ ...base, file: null, link: "https://x.org/a.pdf" })
        .success,
    ).toBe(true);
    expect(OrgDocumentInputSchema.safeParse({ ...base, link: "https://x.org/a.pdf" }).success).toBe(
      false,
    );
    expect(OrgDocumentInputSchema.safeParse({ ...base, file: null, link: "" }).success).toBe(false);
    expect(
      OrgDocumentInputSchema.safeParse({ ...base, file: null, link: "http://x.org" }).success,
    ).toBe(false);
  });

  it("refuses a file path outside the documents prefix and an oversize file", () => {
    for (const bad of [
      { ...file, path: "banners/x.pdf" },
      { ...file, path: "documents/../private.pdf" },
      { ...file, size: 10 * 1024 * 1024 + 1 },
    ]) {
      expect(OrgDocumentInputSchema.safeParse({ ...base, file: bad }).success).toBe(false);
    }
  });
});

describe("groupOrgDocuments", () => {
  it("shows the newest version of a title and folds the older ones", () => {
    const groups = groupOrgDocuments([
      doc("a", { date: "2024-05-01", versionLabel: "2024" }),
      doc("b", { date: "2026-05-01", versionLabel: "2026" }),
      doc("c", { type: "guideline", title: "Code of conduct" }),
    ]);
    const statutes = groups.get("statutes");
    expect(statutes).toHaveLength(1);
    expect(statutes?.[0]?.latest.id).toBe("b");
    expect(statutes?.[0]?.older.map((d) => d.id)).toEqual(["a"]);
    expect(groups.get("guideline")?.[0]?.latest.id).toBe("c");
    expect(groups.has("other")).toBe(false);
  });
});
