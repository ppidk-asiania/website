import { describe, expect, it } from "vitest";
import {
  groupAnswer,
  groupNotice,
  GROUP_KEYWORDS,
  parseGroupKeyword,
  pickRecruitment,
  recruitmentRecap,
  WaGroupSchema,
  type Application,
  type Recruitment,
} from "@website/domain/recruitment";

const recruitment = {
  id: "r1",
  title: "Oprec",
  units: [
    { orgUnitId: "media", name: "Media", quota: 2, portfolioRequired: false, seats: ["member"] },
  ],
} as unknown as Recruitment;
const app = (userId: string, status: Application["status"]): Application =>
  ({
    id: userId,
    recruitmentId: "r1",
    userId,
    status,
    choices: ["media"],
    offer: null,
    interviews: {},
  }) as unknown as Application;
const recap = recruitmentRecap({
  recruitments: [
    { recruitment, applications: [app("a", "submitted"), app("b", "interview")], assessments: [] },
  ],
  origins: new Map([
    ["a", { chapter: "Japan", campus: "Todai", level: "bachelor", entryYear: 2025, gender: "m" }],
    ["b", { chapter: "Japan", campus: "Kyoto", level: "master", entryYear: 2024, gender: "f" }],
  ]),
  scope: { all: true, orgUnitIds: new Set() },
});

describe("keywords", () => {
  it("reads one slash word, any case, nothing else", () => {
    expect(parseGroupKeyword("/rekap")).toBe("rekap");
    expect(parseGroupKeyword("  /REKAP \n")).toBe("rekap");
    expect(parseGroupKeyword("/rekap now")).toBeNull();
    expect(parseGroupKeyword("rekap")).toBeNull();
    expect(parseGroupKeyword("/asiania ABCD2345")).toBeNull();
    expect(GROUP_KEYWORDS).toHaveLength(9);
  });

  it("answers every keyword with counts only", () => {
    for (const k of GROUP_KEYWORDS.filter((k) => k !== "bantuan")) {
      const text = groupAnswer(k, "Oprec", recap);
      expect(text).toContain("Oprec");
      expect(text).not.toMatch(/@|\+?\d{9,}|skor|score/i);
    }
    expect(groupAnswer("kampus", "Oprec", recap)).toContain("• Todai: 1");
    expect(groupAnswer("tren", "Oprec", recap).indexOf("2024")).toBeLessThan(
      groupAnswer("tren", "Oprec", recap).indexOf("2025"),
    );
    expect(groupAnswer("posisi", "Oprec", recap)).toContain("• Media: 2 / 0 / 0 / 2");
  });
});

describe("which recruitment answers", () => {
  const r = (id: string, opens: string, closes: string, extra = {}) =>
    ({
      id,
      published: true,
      deletedAt: null,
      opensAt: new Date(opens),
      closesAt: new Date(closes),
      ...extra,
    }) as unknown as Recruitment;
  const now = new Date("2026-11-16T00:00:00Z");

  it("takes the one accepting applications, else the one opened last", () => {
    const old = r("old", "2026-01-01", "2026-02-01");
    const newer = r("newer", "2026-03-01", "2026-04-01");
    const open = r("open", "2026-11-01", "2026-12-01");
    expect(pickRecruitment([old, newer, open], now)?.id).toBe("open");
    expect(pickRecruitment([old, newer], now)?.id).toBe("newer");
    expect(pickRecruitment([r("gone", "2026-11-01", "2026-12-01", { deletedAt: now })], now)).toBe(
      null,
    );
  });
});

describe("group notice", () => {
  const base = {
    kind: "submitted" as const,
    status: "submitted",
    name: "Siti Rahma",
    campus: "Kyoto University",
    choices: ["Media", "Finance"],
    link: "https://web.example.org/recruitment/r1",
  };

  it("names the applicant, campus, choices and link; no number or e-mail", () => {
    const text = groupNotice(base);
    expect(text).toContain("Siti Rahma");
    expect(text).toContain("Kyoto University");
    expect(text).toContain("Media, Finance");
    expect(text).toContain(base.link);
    expect(text).not.toMatch(/@|\+\d/);
  });

  it("hides the name once the application no longer runs", () => {
    for (const status of ["withdrawn", "rejected", "admin_rejected", "declined", "draft"]) {
      expect(groupNotice({ ...base, status })).not.toContain("Siti Rahma");
    }
    expect(groupNotice({ ...base, status: "interview" })).toContain("Siti Rahma");
  });
});

describe("group setting", () => {
  it("takes a WhatsApp group id and a name", () => {
    expect(WaGroupSchema.safeParse({ id: " 120363041@g.us ", name: "Oprec" }).success).toBe(true);
    expect(WaGroupSchema.safeParse({ id: "628123@c.us", name: "Oprec" }).success).toBe(false);
    expect(WaGroupSchema.safeParse({ id: "120363041@g.us", name: "" }).success).toBe(false);
  });
});
