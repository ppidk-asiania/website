import { describe, expect, it } from "vitest";
import type { Application, Recruitment } from "@website/domain/recruitment";
import {
  choicesLine,
  matchesQueueTab,
  STATUS_HINTS,
  toApplicationItem,
} from "../../apps/admin/src/components/applications-model";
import {
  toRecruitmentItem,
  unitDrafts,
  unitsInput,
} from "../../apps/admin/src/components/recruitment-model";

const r: Recruitment = {
  id: "rec1",
  periodId: "p1",
  title: "Oprec 2026",
  description: "",
  opensAt: new Date("2026-11-01T00:00:00Z"),
  closesAt: new Date("2026-11-20T00:00:00Z"),
  maxChoices: 2,
  units: [
    { orgUnitId: "media", name: "Media", quota: 2, portfolioRequired: true, seats: ["member"] },
  ],
  offerDays: 3,
  formId: "f1",
  formVersion: 2,
  pactTemplateUrl: null,
  personalityTest: true,
  documentDeadline: null,
  interviewRubric: [],
  waGroup: null,
  published: true,
  version: 3,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  deletedAt: null,
};

describe("Recruitment page model", () => {
  it("maps a recruitment with its seats and open state", () => {
    const item = toRecruitmentItem(
      r,
      "2026/2027",
      new Map([["media", { filled: 1 }]]),
      new Date("2026-11-05T00:00:00Z"),
    );
    expect(item).toMatchObject({
      periodName: "2026/2027",
      opensAt: "2026-11-01T00:00:00.000Z",
      open: true,
      units: [{ orgUnitId: "media", quota: 2, filled: 1, portfolioRequired: true }],
    });
    expect(
      toRecruitmentItem(
        { ...r, personalityTest: false, documentDeadline: new Date("2026-11-25T00:00:00Z") },
        "",
        new Map(),
        new Date("2026-11-05T00:00:00Z"),
      ),
    ).toMatchObject({ personalityTest: false, documentDeadline: "2026-11-25T00:00:00.000Z" });
    expect(toRecruitmentItem(r, "", new Map(), new Date("2026-12-01T00:00:00Z"))).toMatchObject({
      open: false,
      units: [{ filled: 0 }],
    });
  });

  it("lists every unit of the period, ticks the offered ones and sends only those", () => {
    const item = toRecruitmentItem(r, "", new Map([["media", { filled: 1 }]]), new Date());
    const drafts = unitDrafts(
      [
        { id: "koor", name: "Koordinator", path: [] },
        { id: "media", name: "Media", path: ["koor"] },
      ],
      item.units,
    );
    expect(drafts).toEqual([
      {
        orgUnitId: "koor",
        name: "Koordinator",
        depth: 0,
        offered: false,
        quota: "1",
        portfolioRequired: false,
        seats: ["member"],
        filled: 0,
      },
      {
        orgUnitId: "media",
        name: "Media",
        depth: 1,
        offered: true,
        quota: "2",
        portfolioRequired: true,
        seats: ["member"],
        filled: 1,
      },
    ]);
    expect(unitsInput(drafts)).toEqual([
      { orgUnitId: "media", quota: 2, portfolioRequired: true, seats: ["member"] },
    ]);
  });
});

describe("selection queue model", () => {
  const at = new Date("2026-11-10T00:00:00Z");
  const application = {
    id: "rec1_ari",
    recruitmentId: "rec1",
    userId: "ari",
    status: "offered" as const,
    choices: ["media", "gone"],
    choiceSeats: { media: "secretary" as const },
    answers: {
      q_why: "Because.",
      q_cv: {
        path: "forms/f1/ari_1.pdf",
        name: "cv.pdf",
        contentType: "application/pdf" as const,
        size: 3,
      },
    },
    portfolio: null,
    revisionRound: 1,
    offer: {
      orgUnitId: "media",
      seat: "head" as const,
      expiresAt: new Date("2026-11-09T00:00:00Z"),
    },
    interviews: {},
    interviewChanged: [],
    pacts: [],
    pactNote: null,
    appointmentId: null,
    submittedAt: at,
    version: 4,
    createdAt: at,
    updatedAt: at,
  };
  const question = (id: string, type: "short_text" | "file") => ({
    id,
    type,
    label: id,
    description: "",
    required: true,
    options: [],
    allowOther: false,
    maxSelections: null,
    min: null,
    max: null,
  });

  it("builds the applicants table cells: origin, choices line, status hint", () => {
    const item = toApplicationItem(application, r, [], null, [], at, null, null, new Map(), null, {
      chapter: "Japan",
      campus: "Todai",
    });
    expect(item.origin).toBe("Japan · Todai");
    expect(choicesLine(item)).toBe("1. Sekretaris Staf Media - 2. gone");
    expect(item.statusHint).toBe(STATUS_HINTS.offered);
    expect(toApplicationItem(application, r, [], null, [], at).origin).toBe("");
  });

  it("maps an application with unit names, answers, files, expired offer and its rounds", () => {
    const item = toApplicationItem(
      application,
      r,
      [question("q_why", "short_text"), question("q_cv", "file")],
      { name: "Ari Wibowo", email: "ari@example.org" },
      [
        {
          applicationId: "rec1_ari",
          round: 1,
          request: "More",
          requestedAt: at,
          requestedBy: "c",
          resubmittedAt: null,
        },
        {
          applicationId: "other",
          round: 1,
          request: "x",
          requestedAt: at,
          requestedBy: "c",
          resubmittedAt: at,
        },
      ],
      at,
    );
    expect(item).toMatchObject({
      name: "Ari Wibowo",
      statusLabel: "Offered",
      choices: [
        { id: "media", name: "Media", seat: "Sekretaris Staf Media" },
        { id: "gone", name: "gone", seat: null },
      ],
      offer: { unitName: "Media", seat: "head", seatLabel: "Kepala Staf Media", expired: true },
      answers: [
        { id: "q_why", text: "Because.", file: null },
        { id: "q_cv", text: "cv.pdf", file: { name: "cv.pdf" } },
      ],
      revisions: [{ round: 1, request: "More", resubmittedAt: null }],
    });
    expect(
      toApplicationItem({ ...application, offer: null, submittedAt: null }, r, [], null, [], at),
    ).toMatchObject({
      name: "ari",
      email: "",
      offer: null,
      submittedAt: null,
      personality: null,
    });
    const axis = (letter: string, pct: number) => ({ letter, pct, lean: 0 });
    expect(
      toApplicationItem(application, r, [], null, [], at, {
        full: "ENFJ-A",
        axes: {
          mind: axis("E", 80),
          energy: axis("N", 60),
          nature: axis("F", 55),
          tactics: axis("J", 70),
          identity: axis("A", 51),
        },
      }).personality,
    ).toEqual({ full: "ENFJ-A", axes: "80% E · 60% N · 55% F · 70% J · 51% A" });
  });

  it("names the files an application is waiting for", () => {
    const follow = { ...question("q_letter", "file"), mayFollow: true };
    const waiting = (a: Application, questions: Parameters<typeof toApplicationItem>[2]) =>
      toApplicationItem(a, r, questions, null, [], at).waitingFor;
    expect(waiting(application, [question("q_cv", "file"), follow])).toEqual(["q_letter"]);
    expect(
      waiting({ ...application, answers: { q_letter: application.answers.q_cv } }, [follow]),
    ).toEqual([]);
  });

  it("puts every status in exactly one step tab", () => {
    expect(matchesQueueTab({ status: "submitted" }, "review")).toBe(true);
    expect(matchesQueueTab({ status: "confirmed" }, "placement")).toBe(true);
    expect(matchesQueueTab({ status: "withdrawn" }, "closed")).toBe(true);
    expect(matchesQueueTab({ status: "withdrawn" }, "all")).toBe(true);
    expect(matchesQueueTab({ status: "interview" }, "offered")).toBe(false);
  });
});
