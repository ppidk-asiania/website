import { describe, expect, it } from "vitest";
import {
  ApplicationInputSchema,
  applicationId,
  assertCanApplyOnPlatform,
  canMoveTo,
  nextStatuses,
  toMyApplication,
  OpportunityInputSchema,
  boardOf,
  canApply,
  filterBoard,
  opportunityPhase,
  toPublicOpportunity,
  type Opportunity,
} from "@website/domain/opportunities";

const input = {
  title: "Summer internship",
  organization: "Acme",
  country: "Japan",
  city: "Tokyo",
  type: "internship",
  description: "<p>Work with us</p>",
  requirements: "",
  deadline: "2026-12-31",
  applyUrl: "https://acme.example/apply",
  image: null,
  status: "open",
  chapterId: null,
} as const;

const post = (extra: Partial<Opportunity> = {}): Opportunity => ({
  id: "o1",
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  title: "Summer internship",
  organization: "Acme",
  country: "Japan",
  city: "Tokyo",
  type: "internship",
  description: "",
  requirements: "",
  deadline: "2026-12-31",
  applyUrl: "https://acme.example/apply",
  image: null,
  status: "open",
  chapterId: null,
  postedBy: "u1",
  ...extra,
});

describe("opportunities (N6.1)", () => {
  it("accepts a posting and turns an empty link into 'apply on the platform'", () => {
    expect(OpportunityInputSchema.safeParse(input).success).toBe(true);
    const parsed = OpportunityInputSchema.parse({ ...input, applyUrl: "" });
    expect(parsed.applyUrl).toBeNull();
  });

  it("refuses a link that is not https, an unknown type and a bad deadline", () => {
    for (const bad of [
      { applyUrl: "http://acme.example" },
      { applyUrl: "javascript:alert(1)" },
      { type: "gig" },
      { deadline: "31-12-2026" },
    ]) {
      expect(OpportunityInputSchema.safeParse({ ...input, ...bad }).success).toBe(false);
    }
  });

  it("is open until the deadline day is over, then greyed; closed ones are archived", () => {
    expect(opportunityPhase(post(), "2026-12-31")).toBe("open");
    expect(opportunityPhase(post(), "2027-01-01")).toBe("past");
    expect(opportunityPhase(post({ deadline: null }), "2030-01-01")).toBe("open");
    expect(opportunityPhase(post({ status: "closed" }), "2026-01-01")).toBe("archived");
    expect(opportunityPhase(post({ deletedAt: new Date() }), "2026-01-01")).toBe("hidden");
    expect(canApply("open")).toBe(true);
    expect(canApply("past")).toBe(false);
  });

  it("lists open and past postings on the board, closed ones in the archive, deleted ones nowhere", () => {
    const rows = [
      post({ id: "a", deadline: "2026-12-31" }),
      post({ id: "b", deadline: "2026-01-01" }),
      post({ id: "c", status: "closed" }),
      post({ id: "d", deletedAt: new Date() }),
    ];
    const today = "2026-06-01";
    expect(boardOf(rows, today, "board").map((o) => o.id)).toEqual(["a", "b"]);
    expect(boardOf(rows, today, "archive").map((o) => o.id)).toEqual(["c"]);
  });

  it("puts still-open postings before greyed ones, the nearest deadline first", () => {
    const rows = [
      post({ id: "past", deadline: "2026-01-01" }),
      post({ id: "late", deadline: "2026-12-31" }),
      post({ id: "soon", deadline: "2026-07-01" }),
      post({ id: "none", deadline: null }),
    ];
    expect(boardOf(rows, "2026-06-01", "board").map((o) => o.id)).toEqual([
      "soon",
      "late",
      "none",
      "past",
    ]);
  });

  it("filters by type and country", () => {
    const rows = [
      post({ id: "a" }),
      post({ id: "b", type: "scholarship" }),
      post({ id: "c", country: "China" }),
    ];
    const ids = (f: Parameters<typeof filterBoard>[1]) => filterBoard(rows, f).map((o) => o.id);
    expect(ids({ type: "scholarship", country: null })).toEqual(["b"]);
    expect(ids({ type: null, country: "China" })).toEqual(["c"]);
    expect(ids({ type: null, country: null })).toEqual(["a", "b", "c"]);
  });

  it("never shows the apply link or who posted in the public shape", () => {
    const shown = toPublicOpportunity(post(), "2026-06-01");
    expect(shown).not.toHaveProperty("applyUrl");
    expect(shown).not.toHaveProperty("postedBy");
    expect(shown).toMatchObject({ external: true, apply: true, phase: "open" });
    expect(toPublicOpportunity(post({ applyUrl: null }), "2026-06-01").external).toBe(false);
    expect(toPublicOpportunity(post(), "2027-06-01")).toMatchObject({
      apply: false,
      phase: "past",
    });
  });
});

describe("applications (N6.2)", () => {
  it("is one application per account per posting", () => {
    expect(applicationId("o1", "u1")).toBe("o1_u1");
    expect(applicationId("o1", "u1")).not.toBe(applicationId("o1", "u2"));
  });

  it("needs a cover letter of some length", () => {
    expect(ApplicationInputSchema.safeParse({ coverLetter: "short" }).success).toBe(false);
    expect(
      ApplicationInputSchema.safeParse({ coverLetter: "I would like to join because..." }).success,
    ).toBe(true);
    expect(ApplicationInputSchema.safeParse({ coverLetter: "x".repeat(20), cv: "x" }).success).toBe(
      false,
    );
  });

  it("only an open posting without an outside link takes applications on the platform", () => {
    const platform = post({ applyUrl: null });
    expect(() => assertCanApplyOnPlatform(platform, "2026-06-01")).not.toThrow();
    expect(() => assertCanApplyOnPlatform(post(), "2026-06-01")).toThrow(/outside/i);
    expect(() => assertCanApplyOnPlatform(platform, "2027-01-01")).toThrow(/closed/i);
    expect(() => assertCanApplyOnPlatform({ ...platform, status: "closed" }, "2026-06-01")).toThrow(
      /closed/i,
    );
    expect(() =>
      assertCanApplyOnPlatform({ ...platform, deletedAt: new Date() }, "2026-06-01"),
    ).toThrow(/exist/i);
  });

  it("moves forward through the chain; offered and rejected are final", () => {
    expect(nextStatuses("submitted")).toEqual(["under_review", "rejected"]);
    expect(canMoveTo("under_review", "interview")).toBe(true);
    expect(canMoveTo("submitted", "interview")).toBe(false);
    expect(canMoveTo("interview", "submitted")).toBe(false);
    expect(nextStatuses("offered")).toEqual([]);
    expect(nextStatuses("rejected")).toEqual([]);
  });

  it("never gives the applicant the internal note or the CV path", () => {
    const mine = toMyApplication(
      {
        id: "o1_u1",
        opportunityId: "o1",
        userId: "u1",
        coverLetter: "Hello there, I am keen",
        cvPath: "opportunities/cv/o1_u1.pdf",
        status: "interview",
        note: "weak English",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      "Summer internship",
    );
    expect(mine).toMatchObject({
      opportunityId: "o1",
      title: "Summer internship",
      status: "interview",
    });
    expect(JSON.stringify(mine)).not.toMatch(/weak English|cv\/o1_u1/);
  });
});
