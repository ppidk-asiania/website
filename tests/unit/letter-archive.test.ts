import { describe, expect, it } from "vitest";
import {
  ARCHIVE_PAGE_SIZE,
  archiveChip,
  ArchiveGuestSchema,
  parseArchiveQuery,
  searchArchive,
  type ArchiveRow,
} from "@website/domain/documents";

const row = (n: number, extra: Partial<ArchiveRow> = {}): ArchiveRow => ({
  code: `CODE${n}`,
  number: `${String(n).padStart(3, "0")}/SK/PPIDK-ASIANIA/XI/2026`,
  letterDate: "2026-11-02",
  subject: `Panitia ${n}`,
  typeId: "sk",
  typeName: "Surat Keputusan",
  unitName: "Sekretariat",
  issuedAt: new Date(`2026-11-02T0${n % 10}:00:00Z`),
  ...extra,
});

describe("public letter archive (14.3)", () => {
  it("reads the filters from the address and ignores anything odd", () => {
    expect(parseArchiveQuery({ q: " sk ", type: "sk", year: "2026", page: "3" })).toEqual({
      q: "sk",
      typeId: "sk",
      year: 2026,
      page: 3,
    });
    expect(parseArchiveQuery({ q: ["a", "b"], type: "x y!", year: "abc", page: "-2" })).toEqual({
      q: "a",
      typeId: null,
      year: null,
      page: 1,
    });
    expect(parseArchiveQuery({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(parseArchiveQuery({})).toEqual({ q: "", typeId: null, year: null, page: 1 });
  });

  it("searches number and subject, filters by type and year, counts types before the type filter", () => {
    const rows = [
      row(3, { typeId: "ske", typeName: "Surat Keterangan", letterDate: "2025-01-05" }),
      row(2, { subject: "Rapat kerja" }),
      row(1),
    ];
    const all = searchArchive(rows, { q: "", typeId: null, year: null, page: 1 });
    expect(all.total).toBe(3);
    expect(all.years).toEqual([2026, 2025]);
    expect(all.types).toEqual([
      { id: "sk", name: "Surat Keputusan", count: 2 },
      { id: "ske", name: "Surat Keterangan", count: 1 },
    ]);
    expect(searchArchive(rows, { q: "RAPAT", typeId: null, year: null, page: 1 }).total).toBe(1);
    expect(searchArchive(rows, { q: "003/sk", typeId: null, year: null, page: 1 }).total).toBe(1);
    const typed = searchArchive(rows, { q: "", typeId: "sk", year: 2026, page: 1 });
    expect(typed.entries.map((e) => e.code)).toEqual(["CODE2", "CODE1"]);
    expect(typed.types.map((t) => t.count)).toEqual([2]);
  });

  it("pages by 20, clamps the page, and never hands out the issue time", () => {
    const rows = Array.from({ length: 45 }, (_, i) => row(i + 1));
    const last = searchArchive(rows, { q: "", typeId: null, year: null, page: 9 });
    expect([last.page, last.pages, last.entries]).toEqual([3, 3, expect.any(Array)]);
    expect(last.entries).toHaveLength(45 - 2 * ARCHIVE_PAGE_SIZE);
    expect(JSON.stringify(last.entries)).not.toContain("issuedAt");
    expect(searchArchive([], { q: "", typeId: null, year: null, page: 1 })).toMatchObject({
      pages: 1,
      total: 0,
      entries: [],
    });
    const noDate = searchArchive([row(1, { letterDate: null })], {
      q: "",
      typeId: null,
      year: 2026,
      page: 1,
    });
    expect(noDate.total).toBe(1);
  });

  it("chips drop a leading 'Surat' and keep one of six colours per type", () => {
    expect(archiveChip("sk", "Surat Keputusan")).toMatchObject({ label: "Keputusan" });
    expect(archiveChip("sk", "Surat")).toMatchObject({ label: "Surat" });
    expect(archiveChip("sk", "SOP").label).toBe("SOP");
    const tones = ["a", "b", "c", "d", "e", "f", "g"].map((id) => archiveChip(id, "x").tone);
    expect(tones.every((t) => t >= 0 && t <= 5)).toBe(true);
    expect(archiveChip("sk", "x").tone).toBe(archiveChip("sk", "y").tone);
  });

  it("the guest book needs a name, an e-mail and an institution; unknown fields are refused", () => {
    const ok = { name: "Arif", email: " Arif@Mail.com ", institution: "UI", captcha: "t" };
    expect(ArchiveGuestSchema.parse(ok)).toMatchObject({ email: "arif@mail.com" });
    expect(ArchiveGuestSchema.safeParse({ ...ok, institution: "" }).success).toBe(false);
    expect(ArchiveGuestSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(ArchiveGuestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});
