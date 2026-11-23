import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  applicationId,
  assertTransition,
  canTransition,
  applicantInScope,
  assertBookable,
  assertBookingChangeable,
  assertSlotEdit,
  bookingOpen,
  canBook,
  hasInterviewScope,
  interviewScope,
  passedReview,
  slotOffered,
  checkChoices,
  checkChoiceSeats,
  makeOffer,
  slotTimes,
  SlotPlanSchema,
  formFilePath,
  isFinal,
  isRecruitmentOpen,
  documentsOpen,
  lateUploadOpen,
  waitingFor,
  applyStep,
  soleOpen,
  nextAction,
  offerExpired,
  portfolioPath,
  portfolioRequired,
  RecruitmentInputSchema,
  type RecruitmentUnit,
  seatCounterId,
  TRANSITIONS,
} from "@website/domain/recruitment";
import { QuestionInputSchema, type Question } from "@website/domain/forms";

const now = new Date("2026-11-10T12:00:00Z");
const window = {
  published: true,
  deletedAt: null,
  opensAt: new Date("2026-11-01T00:00:00Z"),
  closesAt: new Date("2026-11-20T00:00:00Z"),
};
const units: RecruitmentUnit[] = [
  { orgUnitId: "media", name: "Media", quota: 2, portfolioRequired: true, seats: ["member"] },
  { orgUnitId: "finance", name: "Finance", quota: 1, portfolioRequired: false, seats: ["member"] },
  {
    orgUnitId: "edu",
    name: "Education",
    quota: 3,
    portfolioRequired: false,
    seats: ["head", "secretary", "member"],
  },
];
const input = {
  periodId: "p2026",
  title: "Oprec 2026",
  description: "",
  opensAt: "2026-11-01T00:00:00Z",
  closesAt: "2026-11-20T00:00:00Z",
  maxChoices: 2,
  offerDays: 3,
  formId: "form-1",
  units: [{ orgUnitId: "media", quota: 2, portfolioRequired: true }],
};

describe("recruitment set-up (C3)", () => {
  it("validates window, choices, units and offer validity", () => {
    expect(RecruitmentInputSchema.safeParse(input).success).toBe(true);
    expect(RecruitmentInputSchema.parse(input).pactTemplateUrl).toBeNull();
    expect(
      RecruitmentInputSchema.parse({ ...input, pactTemplateUrl: " https://drive.example/p " })
        .pactTemplateUrl,
    ).toBe("https://drive.example/p");
    for (const bad of [
      { closesAt: "2026-10-01T00:00:00Z" },
      { maxChoices: 0 },
      { maxChoices: 6 },
      { offerDays: 0 },
      { units: [] },
      { units: [input.units[0], input.units[0]] },
      { units: [{ orgUnitId: "media", quota: 0, portfolioRequired: false }] },
      { formId: "a/b" },
      { pactTemplateUrl: "http://insecure.example/pakta" },
      { title: "ab" },
      { extra: true },
    ]) {
      expect(
        RecruitmentInputSchema.safeParse({ ...input, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("is open only when published, not deleted and inside the window", () => {
    expect(isRecruitmentOpen(window, now)).toBe(true);
    expect(isRecruitmentOpen({ ...window, published: false }, now)).toBe(false);
    expect(isRecruitmentOpen({ ...window, deletedAt: now }, now)).toBe(false);
    expect(isRecruitmentOpen(window, window.closesAt)).toBe(false);
    expect(isRecruitmentOpen(window, window.opensAt)).toBe(true);
    expect(isRecruitmentOpen(window, new Date("2026-10-31T23:59:59Z"))).toBe(false);
  });

  it("names applications and seat counters deterministically", () => {
    expect(applicationId("rec1", "uid9")).toBe("rec1_uid9");
    expect(seatCounterId("rec1", "media")).toBe("rec1_media");
  });
});

describe("application status machine (C3)", () => {
  it("has a rule for every status, and the ends lead nowhere", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...APPLICATION_STATUSES].sort());
    for (const status of [
      "admin_rejected",
      "declined",
      "confirmed",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(isFinal(status), status).toBe(true);
    }
    expect(isFinal("submitted")).toBe(false);
  });

  it("follows the C3 workflow", () => {
    const path = [
      ["draft", "submitted"],
      ["submitted", "revision"],
      ["revision", "submitted"],
      ["submitted", "interview"],
      ["interview", "offered"],
      ["offered", "accepted"],
      ["accepted", "approved"],
      ["approved", "pakta_review"],
      ["pakta_review", "approved"],
      ["pakta_review", "confirmed"],
    ] as const;
    for (const [from, to] of path) expect(canTransition(from, to), `${from}→${to}`).toBe(true);
    expect(canTransition("submitted", "offered")).toBe(false);
    expect(canTransition("draft", "interview")).toBe(false);
    expect(canTransition("confirmed", "withdrawn")).toBe(false);
    expect(() => assertTransition("submitted", "confirmed")).toThrow(/cannot move/);
    expect(() => assertTransition("submitted", "interview")).not.toThrow();
  });
});

describe("applying (C3 steps 1-2)", () => {
  const rec = { maxChoices: 2, units };

  it("takes 1..N distinct ordered choices from the recruitment's units", () => {
    expect(checkChoices(rec, ["finance", "media"])).toEqual(["finance", "media"]);
    expect(() => checkChoices(rec, [])).toThrow(/at least one/);
    expect(() => checkChoices(rec, "media")).toThrow(/at least one/);
    expect(() => checkChoices(rec, ["media", "finance", "edu"])).toThrow(/at most 2/);
    expect(() => checkChoices(rec, ["media", "media"])).toThrow(/once/);
    expect(() => checkChoices(rec, ["sports"])).toThrow(/units of this recruitment/);
  });

  it("asks for a portfolio only when a chosen unit is flagged", () => {
    expect(portfolioRequired(rec, ["finance", "edu"])).toBe(false);
    expect(portfolioRequired(rec, ["finance", "media"])).toBe(true);
    expect(portfolioPath("rec1", "uid9", now, "abcdef12-0000")).toBe(
      `recruitment/rec1/uid9/portfolio_${now.getTime()}_abcdef12.pdf`,
    );
    expect(formFilePath("form1", "uid9", now, "abcdef12-0000")).toBe(
      `forms/form1/uid9_${now.getTime()}_abcdef12.pdf`,
    );
  });

  it("opens the apply wizard on the first unfinished step and never past what is done", () => {
    const none = { profile: false, proof: false };
    const profile = { profile: true, proof: false };
    const both = { profile: true, proof: true };
    expect(applyStep(none)).toBe(1);
    expect(applyStep(profile)).toBe(2);
    expect(applyStep(both)).toBe(3);
    expect(applyStep(both, 4)).toBe(4);
    expect(applyStep(both, 1)).toBe(1);
    expect(applyStep(profile, 3)).toBe(2);
    expect(applyStep(none, 2)).toBe(1);
    expect(applyStep(both, 9)).toBe(3);
  });

  it("goes straight to the only open recruitment", () => {
    const one = { ...window, id: "one" };
    const closed = { ...one, id: "closed", published: false };
    expect(soleOpen([one], now)?.id).toBe("one");
    expect(soleOpen([closed, one], now)?.id).toBe("one");
    expect(soleOpen([one, { ...one, id: "two" }], now)).toBeNull();
    expect(soleOpen([closed], now)).toBeNull();
  });

  it("shows ONE next action per state", () => {
    const offer = {
      orgUnitId: "media",
      seat: "member" as const,
      expiresAt: new Date("2026-11-11T00:00:00Z"),
    };
    const at = (status: (typeof APPLICATION_STATUSES)[number]) =>
      nextAction(window, { status, offer: status === "offered" ? offer : null }, now);
    expect(nextAction(window, null, now)).toBe("start");
    expect(nextAction({ ...window, published: false }, null, now)).toBe("closed");
    expect(at("draft")).toBe("complete");
    expect(at("revision")).toBe("revise");
    expect(at("submitted")).toBe("wait_review");
    expect(at("interview")).toBe("interview");
    expect(at("offered")).toBe("respond_offer");
    expect(at("accepted")).toBe("wait_approval");
    expect(at("approved")).toBe("upload_pact");
    expect(at("pakta_review")).toBe("wait_ratification");
    expect(at("confirmed")).toBe("welcome");
    for (const s of ["admin_rejected", "declined", "rejected", "withdrawn"] as const) {
      expect(at(s)).toBe("ended");
    }
    const after = new Date("2026-11-21T00:00:00Z");
    expect(nextAction(window, { status: "draft", offer: null }, after)).toBe("closed");
    expect(nextAction(window, { status: "revision", offer: null }, after)).toBe("closed");
    expect(offerExpired(offer, offer.expiresAt)).toBe(true);
    expect(offerExpired(offer, now)).toBe(false);
    expect(offerExpired(null, now)).toBe(false);
    expect(nextAction(window, { status: "offered", offer }, new Date("2026-11-12T00:00:00Z"))).toBe(
      "ended",
    );
  });
});

describe("interview slots (C3-I)", () => {
  const plan = SlotPlanSchema.parse({
    date: "2026-11-15",
    timeZone: "Asia/Tokyo",
    startTime: "09:00",
    endTime: "12:00",
    durationMinutes: 30,
    gapMinutes: 10,
    breaks: [{ start: "10:30", end: "11:00" }],
    capacity: 2,
    location: "https://meet.example/oprec",
  });

  it("generates UTC times from a day plan in the committee's zone, skipping breaks", () => {
    expect(slotTimes(plan).map((d) => d.toISOString())).toEqual([
      "2026-11-15T00:00:00.000Z",
      "2026-11-15T00:40:00.000Z",
      "2026-11-15T02:00:00.000Z",
    ]);
    expect(slotTimes({ ...plan, breaks: [], gapMinutes: 0 })).toHaveLength(6);
    expect(() =>
      slotTimes({
        ...plan,
        startTime: "00:00",
        endTime: "23:59",
        durationMinutes: 5,
        breaks: [],
        gapMinutes: 0,
      }),
    ).toThrow(/At most 100/);
  });

  it("validates the plan", () => {
    for (const bad of [
      { endTime: "08:00" },
      { startTime: "9:00" },
      { timeZone: "Mars/Base" },
      { durationMinutes: 1 },
      { capacity: 0 },
      { breaks: [{ start: "11:00", end: "10:00" }] },
      { location: "<b>" },
    ]) {
      expect(SlotPlanSchema.safeParse({ ...plan, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("books only future, live slots with room", () => {
    const slot = {
      id: "s1",
      recruitmentId: "rec1",
      startsAt: new Date("2026-11-15T00:00:00Z"),
      durationMinutes: 30,
      capacity: 2,
      booked: 1,
      location: "",
      deletedAt: null,
      interviewerUid: null,
      orgUnitId: null,
      timeZone: "UTC",
      mode: "online" as const,
      note: "",
      bookingCutoffHours: 12,
      version: 1,
    };
    const before = new Date("2026-11-14T00:00:00Z");
    expect(canBook(slot, before)).toBe(true);
    expect(canBook({ ...slot, booked: 2 }, before)).toBe(false);
    expect(canBook(slot, slot.startsAt)).toBe(false);
    expect(canBook({ ...slot, deletedAt: before }, before)).toBe(false);
    expect(assertBookable(slot, before)).toBe(slot);
    expect(() => assertBookable({ ...slot, booked: 2 }, before)).toThrow(/full/);
    expect(() => assertBookable(null, before)).toThrow(/no longer available/);
    expect(() => assertBookable(slot, slot.startsAt)).toThrow(/no longer available/);
  });

  it("closes booking bookingCutoffHours before the start (default 12)", () => {
    const slot = {
      id: "s1",
      recruitmentId: "rec1",
      startsAt: new Date("2026-11-15T12:00:00Z"),
      durationMinutes: 30,
      capacity: 2,
      booked: 0,
      location: "",
      deletedAt: null,
      interviewerUid: null,
      orgUnitId: null,
      timeZone: "UTC",
      mode: "online" as const,
      note: "",
      bookingCutoffHours: 12,
      version: 1,
    };
    expect(bookingOpen(slot, new Date("2026-11-14T23:59:00Z"))).toBe(true);
    expect(bookingOpen(slot, new Date("2026-11-15T00:00:00Z"))).toBe(false);
    expect(canBook(slot, new Date("2026-11-15T01:00:00Z"))).toBe(false);
    expect(() => assertBookable(slot, new Date("2026-11-15T01:00:00Z"))).toThrow(/closed/);
    expect(bookingOpen({ ...slot, bookingCutoffHours: 0 }, new Date("2026-11-15T11:59:00Z"))).toBe(
      true,
    );
  });
});

describe("who interviews (11.5)", () => {
  const units = [
    { id: "dir", path: [] },
    { id: "finance", path: ["dir"] },
    { id: "media", path: ["dir"] },
    { id: "other", path: [] },
  ];
  const seat = (orgUnitId: string, unitType: string, kind: string) => ({
    orgUnitId,
    orgUnitPath: [...(units.find((u) => u.id === orgUnitId)?.path ?? []), orgUnitId],
    unitType: unitType as "divisi",
    seat: kind as "head",
  });
  const scope = (
    seats: ReturnType<typeof seat>[],
    review = false,
    granted: "all" | string[] = [],
  ) => interviewScope({ seats, units, review, granted });

  it("head, deputy head and secretary of a division interview that unit only", () => {
    for (const kind of ["head", "deputy_head", "secretary"]) {
      const s = scope([seat("finance", "divisi", kind)]);
      expect([...s.orgUnitIds]).toEqual(["finance"]);
      expect([...s.slotUnitIds]).toEqual(["finance"]);
      expect(s.all).toBe(false);
      expect(hasInterviewScope(s)).toBe(true);
    }
  });

  it("treasurer and member seats give no scope", () => {
    for (const kind of ["treasurer", "member"]) {
      expect(hasInterviewScope(scope([seat("finance", "divisi", kind)]))).toBe(false);
    }
    expect(hasInterviewScope(scope([]))).toBe(false);
  });

  it("a directorate or bureau head interviews the unit and every unit below it", () => {
    for (const type of ["direktorat", "biro"]) {
      const s = scope([seat("dir", type, "head")]);
      expect([...s.orgUnitIds].sort()).toEqual(["dir", "finance", "media"]);
      expect([...s.slotUnitIds]).toEqual(["dir"]);
    }
  });

  it("recruitment.review and a global recruitment.interview mean everyone; a scoped one its unit tree", () => {
    expect(scope([], true).all).toBe(true);
    expect(scope([], false, "all").all).toBe(true);
    const scoped = scope([], false, ["dir"]);
    expect(scoped.all).toBe(false);
    expect([...scoped.orgUnitIds].sort()).toEqual(["dir", "finance", "media"]);
    expect([...scoped.slotUnitIds]).toEqual(["dir"]);
  });

  it("an applicant is in scope by a chosen unit, or by booking my slot", () => {
    const s = scope([seat("finance", "divisi", "head")]);
    const slots = new Map([
      ["mine", { interviewerUid: "me" }],
      ["theirs", { interviewerUid: "x" }],
    ]);
    const app = (choices: string[], slotId?: string) => ({
      choices,
      interviews: slotId ? { [choices[0] ?? ""]: { slotId } } : {},
    });
    expect(applicantInScope(s, "me", app(["media", "finance"]), slots)).toBe(true);
    expect(applicantInScope(s, "me", app(["media"]), slots)).toBe(false);
    expect(applicantInScope(s, "me", app(["media"], "mine"), slots)).toBe(true);
    expect(applicantInScope(s, "me", app(["media"], "theirs"), slots)).toBe(false);
    expect(applicantInScope(scope([], true), "me", app(["media"]), slots)).toBe(true);
  });

  it("only applicants past the document check are shown to interviewers", () => {
    expect(passedReview("interview")).toBe(true);
    expect(passedReview("confirmed")).toBe(true);
    for (const status of [
      "draft",
      "submitted",
      "revision",
      "admin_rejected",
      "withdrawn",
    ] as const) {
      expect(passedReview(status)).toBe(false);
    }
  });

  it("a slot is offered to its unit and every unit below it; a committee slot to all", () => {
    expect(slotOffered({ orgUnitId: "dir" }, "finance", ["dir"])).toBe(true);
    expect(slotOffered({ orgUnitId: "finance" }, "finance", ["dir"])).toBe(true);
    expect(slotOffered({ orgUnitId: "finance" }, "media", ["dir"])).toBe(false);
    expect(slotOffered({ orgUnitId: null }, "media", ["dir"])).toBe(true);
  });

  it("a booked slot cannot move, shrink below its bookings or lose its unit; text fields can change", () => {
    const slot = {
      startsAt: new Date("2026-11-15T00:00:00Z"),
      capacity: 2,
      booked: 2,
      durationMinutes: 30,
    };
    expect(() => assertSlotEdit(slot, { startsAt: new Date("2026-11-15T01:00:00Z") })).toThrow(
      /booked/,
    );
    expect(() => assertSlotEdit(slot, { capacity: 1 })).toThrow(/bookings/);
    expect(() => assertSlotEdit(slot, { durationMinutes: 45 })).toThrow(/booked/);
    expect(() => assertSlotEdit(slot, { capacity: 3, location: "x", note: "y" })).not.toThrow();
    expect(() =>
      assertSlotEdit({ ...slot, booked: 0 }, { capacity: 1, startsAt: new Date() }),
    ).not.toThrow();
  });

  it("a booking is changed once, never after it was recorded or past the cut-off", () => {
    const booking = {
      slotId: "s",
      startsAt: new Date("2026-11-15T12:00:00Z"),
      attendance: null,
      attendanceNote: null,
    };
    const early = new Date("2026-11-14T00:00:00Z");
    expect(() => assertBookingChangeable(booking, 12, false, early)).not.toThrow();
    expect(() => assertBookingChangeable(booking, 12, true, early)).toThrow(/once/);
    expect(() =>
      assertBookingChangeable({ ...booking, attendance: "attended" }, 12, false, early),
    ).toThrow(/recorded/);
    expect(() =>
      assertBookingChangeable(booking, 12, false, new Date("2026-11-15T01:00:00Z")),
    ).toThrow(/closed/);
  });
});

describe("recruitment switches (11.2)", () => {
  it("keeps the personality test on by default and the document deadline optional", () => {
    expect(RecruitmentInputSchema.parse(input)).toMatchObject({
      personalityTest: true,
      documentDeadline: null,
    });
    expect(
      RecruitmentInputSchema.parse({
        ...input,
        personalityTest: false,
        documentDeadline: "2026-11-25T00:00:00Z",
      }),
    ).toMatchObject({ personalityTest: false, documentDeadline: new Date("2026-11-25T00:00:00Z") });
    expect(
      RecruitmentInputSchema.parse({ ...input, documentDeadline: null }).documentDeadline,
    ).toBe(null);
    expect(RecruitmentInputSchema.safeParse({ ...input, personalityTest: "no" }).success).toBe(
      false,
    );
  });

  const question = (patch: Record<string, unknown>) => ({
    id: "q_letter",
    type: "file",
    label: "Recommendation letter",
    description: "",
    required: true,
    options: [],
    allowOther: false,
    maxSelections: null,
    min: null,
    max: null,
    ...patch,
  });

  it("lets only file questions follow, and stores the flag only when set", () => {
    expect(QuestionInputSchema.parse(question({ mayFollow: true }))).toMatchObject({
      mayFollow: true,
    });
    expect(QuestionInputSchema.parse(question({ mayFollow: false }))).not.toHaveProperty(
      "mayFollow",
    );
    expect(QuestionInputSchema.parse(question({}))).not.toHaveProperty("mayFollow");
    expect(
      QuestionInputSchema.safeParse(question({ type: "short_text", mayFollow: true })).success,
    ).toBe(false);
  });

  const letter = QuestionInputSchema.parse(question({ mayFollow: true })) as Question;
  const cv = QuestionInputSchema.parse(question({ id: "q_cv", label: "CV" })) as Question;

  it("lists the files an application still waits for", () => {
    expect(waitingFor([letter, cv], {})).toEqual([letter]);
    expect(waitingFor([letter, cv], { q_letter: "x" })).toEqual([]);
  });

  it("accepts late files until the deadline, or without a limit when there is none", () => {
    const deadline = new Date("2026-11-25T00:00:00Z");
    expect(documentsOpen({ documentDeadline: null }, now)).toBe(true);
    expect(documentsOpen({ documentDeadline: deadline }, deadline)).toBe(true);
    expect(documentsOpen({ documentDeadline: deadline }, new Date("2026-11-25T00:00:01Z"))).toBe(
      false,
    );
    const open = { documentDeadline: deadline };
    expect(lateUploadOpen(open, "submitted", now)).toBe(true);
    expect(lateUploadOpen(open, "interview", now)).toBe(true);
    expect(lateUploadOpen(open, "draft", now)).toBe(false);
    expect(lateUploadOpen(open, "withdrawn", now)).toBe(false);
    expect(lateUploadOpen(open, "submitted", new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });

  it("shows upload_later below the status actions", () => {
    const status = (s: (typeof APPLICATION_STATUSES)[number], later: boolean) =>
      nextAction(window, { status: s, offer: null }, now, later);
    expect(status("submitted", true)).toBe("upload_later");
    expect(status("submitted", false)).toBe("wait_review");
    expect(status("revision", true)).toBe("revise");
    expect(status("interview", true)).toBe("interview");
  });
});

describe("seats per unit (step 11.1)", () => {
  const rec = { maxChoices: 2, units, offerDays: 3 };

  it("opens [member] by default and only known seats", () => {
    expect(RecruitmentInputSchema.parse(input).units[0]?.seats).toEqual(["member"]);
    const open = (seats: string[]) =>
      RecruitmentInputSchema.safeParse({
        ...input,
        units: [{ ...input.units[0], seats }],
      }).success;
    expect(open(["head", "secretary"])).toBe(true);
    expect(open([])).toBe(false);
    expect(open(["boss"])).toBe(false);
    expect(open(["member", "member"])).toBe(false);
  });

  it("fills a single seat silently and takes the wish for a unit with several", () => {
    expect(checkChoiceSeats(rec, ["media"], {}, true)).toEqual({ media: "member" });
    expect(checkChoiceSeats(rec, ["media"], undefined, true)).toEqual({ media: "member" });
    expect(() => checkChoiceSeats(rec, ["media"], { media: "boss" }, true)).toThrow(
      /from the list/,
    );
    expect(checkChoiceSeats(rec, ["media", "edu"], { edu: "secretary" }, true)).toEqual({
      media: "member",
      edu: "secretary",
    });
    expect(checkChoiceSeats(rec, ["edu"], {}, false)).toEqual({});
    expect(() => checkChoiceSeats(rec, ["edu"], {}, true)).toThrow(/Choose a seat in Education/);
    expect(() => checkChoiceSeats(rec, ["edu"], { edu: "treasurer" }, true)).toThrow(
      /not open in Education/,
    );
  });

  it("offers only a seat the unit opened", () => {
    expect(makeOffer(rec, "edu", "head", now)).toMatchObject({ orgUnitId: "edu", seat: "head" });
    expect(() => makeOffer(rec, "media", "head", now)).toThrow(/not open in Media/);
  });
});
