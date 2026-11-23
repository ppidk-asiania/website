import { describe, expect, it } from "vitest";
import { matchesQueueTab, QUEUE_TABS } from "../../apps/admin/src/components/applications-model";
import {
  DEFAULT_RUBRIC,
  recruitmentRecap,
  type Application,
  type Assessment,
  type Recruitment,
} from "@website/domain/recruitment";

const recruitment = {
  id: "r1",
  title: "Oprec",
  units: [
    { orgUnitId: "media", name: "Media", quota: 2, portfolioRequired: false, seats: ["member"] },
    { orgUnitId: "fin", name: "Finance", quota: 1, portfolioRequired: false, seats: ["member"] },
  ],
} as unknown as Recruitment;

const app = (
  userId: string,
  status: Application["status"],
  choices: string[],
  extra: Partial<Application> = {},
): Application =>
  ({
    id: `r1_${userId}`,
    recruitmentId: "r1",
    userId,
    status,
    choices,
    offer: null,
    interviews: {},
    ...extra,
  }) as unknown as Application;

const booking = (attendance: "attended" | "absent" | null) => ({
  slotId: "s",
  startsAt: new Date(0),
  attendance,
  attendanceNote: null,
});

const assessment = (
  appId: string,
  choiceId: string,
  uid: string,
  score: number,
  relation = "no close relation",
) =>
  ({
    id: `${appId}_${choiceId}_${uid}`,
    interviewKey: `${appId}_${choiceId}`,
    applicationId: appId,
    recruitmentId: "r1",
    choiceId,
    uid,
    rubric: DEFAULT_RUBRIC.map(({ key, label, weight }) => ({ key, label, weight })),
    scores: Object.fromEntries(DEFAULT_RUBRIC.map((a) => [a.key, score])),
    recommendation: score > 2 ? "recommended" : "unsure",
    note: "",
    relation,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }) as Assessment;

const applications = [
  app("a", "submitted", ["media", "fin"]),
  app("b", "interview", ["media"], { interviews: { media: booking("attended") } }),
  app("c", "interview", ["fin", "media"], { interviews: { fin: booking(null) } }),
  app("d", "accepted", ["media"], {
    offer: { orgUnitId: "media", seat: "member", expiresAt: new Date(0) },
    interviews: { media: booking("absent") },
  }),
  app("e", "withdrawn", ["fin"]),
  app("x", "draft", ["fin"]),
];
const origins = new Map([
  ["a", { chapter: "Japan", campus: "Todai", level: "bachelor", entryYear: 2025, gender: "male" }],
  ["b", { chapter: "Japan", campus: "Todai", level: "master", entryYear: 2025, gender: "female" }],
  ["c", { chapter: "Korea", campus: "SNU", level: "bachelor", entryYear: 2024, gender: "female" }],
]);
origins.set("d", origins.get("a")!);
origins.set("e", origins.get("c")!);
const assessments = [
  assessment("r1_b", "media", "i1", 4, "friend"),
  assessment("r1_b", "media", "i2", 2),
];
const input = (scope: { all: boolean; orgUnitIds: ReadonlySet<string> }) => ({
  recruitments: [{ recruitment, applications, assessments }],
  origins,
  scope,
});
const all = { all: true, orgUnitIds: new Set<string>() };

describe("recruitmentRecap (11.7)", () => {
  it("stage counts equal the counts of the list tabs and skip drafts", () => {
    const recap = recruitmentRecap(input(all));
    expect(recap.total).toBe(5);
    for (const tab of QUEUE_TABS.filter((t) => t.key !== "all")) {
      expect(recap.stages.find((s) => s.key === tab.key)?.count).toBe(
        applications.filter((a) => matchesQueueTab(a, tab.key) && a.status !== "draft").length,
      );
    }
  });

  it("counts interest per unit with accepted and quota", () => {
    const { units } = recruitmentRecap(input(all));
    expect(units.find((u) => u.orgUnitId === "media")).toMatchObject({
      choice1: 3,
      choice2: 1,
      accepted: 1,
      quota: 2,
    });
    expect(units.find((u) => u.orgUnitId === "fin")).toMatchObject({ choice1: 2, choice2: 1 });
  });

  it("spreads people by origin, largest first", () => {
    const { spread } = recruitmentRecap(input(all));
    expect(spread.chapter).toEqual([
      { label: "Japan", count: 3 },
      { label: "Korea", count: 2 },
    ]);
    expect(spread.campus[0]).toEqual({ label: "Todai", count: 3 });
    expect(spread.gender).toEqual([
      { label: "female", count: 3 },
      { label: "male", count: 2 },
    ]);
  });

  it("builds the interview block", () => {
    const { interviews } = recruitmentRecap(input(all));
    expect(interviews).toMatchObject({
      scheduled: 3,
      attended: 1,
      absent: 1,
      assessed: 1,
      relationDeclared: 1,
    });
    expect(interviews.aspects[0]).toMatchObject({ label: DEFAULT_RUBRIC[0]!.label, average: 3 });
    expect(interviews.recommendations).toMatchObject({ recommended: 1, unsure: 1 });
  });

  it("limits a scoped viewer to the applications and interviews of their units", () => {
    const recap = recruitmentRecap(input({ all: false, orgUnitIds: new Set(["fin"]) }));
    expect(recap.total).toBe(3);
    expect(recap.units.map((u) => u.orgUnitId)).toEqual(["fin"]);
    expect(recap.interviews).toMatchObject({ scheduled: 1, assessed: 0 });
  });
});
