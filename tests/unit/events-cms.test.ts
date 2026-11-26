import { describe, expect, it } from "vitest";
import {
  EVENT_TYPES,
  EventAfterSchema,
  EventInputSchema,
  approvalState,
  approvalToPublish,
  approveEvent,
  askForApproval,
  assertPublishAt,
  cancelEvent,
  eventStage,
  isLive,
  isPast,
  isRegistrationOpen,
  NO_APPROVAL,
  randomEventSlug,
  rejectEvent,
  sortedSponsors,
  toPublicEvent,
} from "@website/domain/events";

const image = {
  url: "https://storage.example/events/banners/a.webp",
  thumbUrl: "https://storage.example/events/banners/a_thumb.webp",
  path: "events/banners/a.webp",
  thumbPath: "events/banners/a_thumb.webp",
  width: 2400,
  height: 1200,
};
const valid = {
  title: "Simposium 2026",
  type: "seminar",
  startsAt: "2026-11-20T02:00:00.000Z",
  timezone: "Asia/Tokyo",
  registrationClosesAt: "2026-11-19T15:00:00.000Z",
  location: "Tokyo",
  description: "Simposium tahunan.",
  bannerImage: image,
  registrationUrl: "",
  slug: "",
  schedule: [{ time: "09:00", title: "Pembukaan", description: "" }],
  speakers: [{ name: "Dr. Sari", description: "Peneliti", photo: null }],
  sponsors: [
    { logo: image, caption: "Sponsor A" },
    { logo: null, caption: "Sponsor B" },
  ],
};

describe("event form (EVENT DASHBOARD)", () => {
  it("accepts a complete event; empty registration link becomes null", () => {
    const parsed = EventInputSchema.parse(valid);
    expect(parsed.registrationUrl).toBeNull();
    expect(parsed.startsAt).toEqual(new Date(valid.startsAt));
  });

  it("registration deadline must be on or before the event date", () => {
    expect(
      EventInputSchema.safeParse({ ...valid, registrationClosesAt: valid.startsAt }).success,
    ).toBe(true);
    const late = EventInputSchema.safeParse({
      ...valid,
      registrationClosesAt: "2026-11-21T00:00:00.000Z",
    });
    expect(late.success).toBe(false);
    expect(late.error?.issues[0]?.path).toEqual(["registrationClosesAt"]);
  });

  it("refuses unknown types, time zones, bad links, slugs and schedule times", () => {
    for (const bad of [
      { type: "party" },
      { timezone: "Mars/Olympus" },
      { registrationUrl: "javascript:alert(1)" },
      { slug: "Not A Slug" },
      { schedule: [{ time: "9am", title: "x", description: "" }] },
      { bannerImage: null },
      { title: "<script>x</script>" },
      { extra: true },
    ]) {
      expect(EventInputSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("has a fixed type list (labels live in the app)", () => {
    expect(EVENT_TYPES).toContain("webinar");
  });

  it("random slug when the URL is left empty", () => {
    expect(randomEventSlug("3f2a9c1e-0000-4000-8000-000000000000")).toBe("event-3f2a9c1e");
  });

  it("a deleted event never takes registrations", () => {
    const open = {
      published: true,
      deletedAt: null,
      publishAt: null,
      cancelledAt: null,
      startsAt: new Date("2026-12-01T00:00:00Z"),
      registrationClosesAt: null,
    };
    const now = new Date("2026-11-01T00:00:00Z");
    expect(isRegistrationOpen(open, now)).toBe(true);
    expect(isRegistrationOpen({ ...open, deletedAt: now }, now)).toBe(false);
  });

  it("a cancelled event or one waiting for its publish time takes no registrations", () => {
    const open = {
      published: true,
      deletedAt: null,
      publishAt: null,
      cancelledAt: null,
      startsAt: new Date("2026-12-01T00:00:00Z"),
      registrationClosesAt: null,
    };
    const now = new Date("2026-11-01T00:00:00Z");
    expect(isRegistrationOpen({ ...open, cancelledAt: now }, now)).toBe(false);
    expect(isRegistrationOpen({ ...open, publishAt: new Date("2026-11-02T00:00:00Z") }, now)).toBe(
      false,
    );
  });

  it("sponsors are shown by their order number", () => {
    expect(
      sortedSponsors([
        { order: 2, logo: null, caption: "B" },
        { order: 1, logo: null, caption: "A" },
      ]).map((s) => s.caption),
    ).toEqual(["A", "B"]);
  });
});

describe("public event (DTO)", () => {
  it("keeps only what visitors see, sponsors in order", () => {
    const now = new Date("2026-10-18T00:00:00Z");
    const dto = toPublicEvent({
      id: "e1",
      version: 4,
      slug: "s",
      title: "S",
      summary: null,
      startsAt: now,
      endsAt: null,
      timezone: "Asia/Tokyo",
      location: "Tokyo",
      chapterId: "jp",
      published: true,
      capacity: 10,
      registrationClosesAt: null,
      type: "seminar",
      description: "D",
      bannerImage: null,
      registrationUrl: null,
      schedule: [],
      speakers: [],
      sponsors: [
        { order: 2, logo: null, caption: "B" },
        { order: 1, logo: null, caption: "A" },
      ],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      publishAt: null,
      approvalRequestedAt: null,
      approvalRequestedBy: null,
      approvedAt: null,
      approvedBy: null,
      rejectionNote: "internal",
      cancelledAt: null,
      cancelReason: null,
      finalAttendance: 120,
      attendanceNote: "80 online, 40 on site",
      recapUrl: null,
      registration: null,
      fee: null,
    });
    expect(dto).not.toHaveProperty("rejectionNote");
    expect(dto).not.toHaveProperty("approvedBy");
    expect(dto).toMatchObject({ finalAttendance: 120, attendanceNote: "80 online, 40 on site" });
    expect(dto).not.toHaveProperty("version");
    expect(dto).not.toHaveProperty("capacity");
    expect(dto).toMatchObject({ id: "e1", chapterId: "jp", location: "Tokyo" });
    expect(dto.sponsors.map((s) => s.caption)).toEqual(["A", "B"]);
  });
});

describe("event life cycle (N1.1)", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const base: Parameters<typeof eventStage>[0] = {
    published: true,
    deletedAt: null,
    publishAt: null,
    startsAt: day("2026-11-10"),
    endsAt: day("2026-11-11"),
  };

  it("a published event with a future publishAt is hidden until then (read-time, no job)", () => {
    const scheduled = { ...base, publishAt: day("2026-11-05") };
    expect(isLive(scheduled, day("2026-11-04"))).toBe(false);
    expect(isLive(scheduled, day("2026-11-05"))).toBe(true);
    expect(isLive({ ...scheduled, published: false }, day("2026-11-06"))).toBe(false);
    expect(isLive({ ...base, deletedAt: day("2026-11-01") }, day("2026-11-06"))).toBe(false);
  });

  it("shows five stages: preparing, public, running, after, locked 14 days after the end", () => {
    const stage = (iso: string, e = base) => eventStage(e, new Date(iso));
    expect(stage("2026-11-01T00:00:00Z", { ...base, published: false })).toBe("preparing");
    expect(stage("2026-11-01T00:00:00Z", { ...base, publishAt: day("2026-11-03") })).toBe(
      "preparing",
    );
    expect(stage("2026-11-09T23:59:59Z")).toBe("public");
    expect(stage("2026-11-10T12:00:00Z")).toBe("running");
    expect(stage("2026-11-11T00:00:00Z")).toBe("after");
    expect(stage("2026-11-24T23:59:59Z")).toBe("after");
    expect(stage("2026-11-25T00:00:00Z")).toBe("locked");
  });

  it("past = ended, or started when no end is set", () => {
    expect(isPast({ startsAt: day("2026-11-10"), endsAt: null }, day("2026-11-10"))).toBe(true);
    expect(
      isPast({ startsAt: day("2026-11-10"), endsAt: day("2026-11-11") }, day("2026-11-10")),
    ).toBe(false);
  });

  it("only an approved event can go public; a holder who publishes approves by doing so", () => {
    const now = day("2026-11-01");
    expect(() => approvalToPublish(null, false, "a", now)).toThrow(/Ask for approval/);
    expect(approvalToPublish(null, true, "boss", now)).toMatchObject({
      approvedBy: "boss",
      approvedAt: now,
    });
    const asked = askForApproval(NO_APPROVAL, "ed", now);
    expect(approvalState(asked)).toBe("pending");
    expect(() => approvalToPublish(asked, true, "boss", now)).toThrow(/Decide the approval/);
    expect(() => askForApproval(asked, "ed", now)).toThrow(/already waiting/);
    const approved = approveEvent(asked, "boss", now);
    expect(approvalState(approved)).toBe("approved");
    expect(approvalToPublish(approved, false, "ed", now)).toBe(approved);
    expect(() => askForApproval(approved, "ed", now)).toThrow(/already approved/);
  });

  it("a rejected request is a draft again that can be asked once more", () => {
    const now = day("2026-11-01");
    const rejected = rejectEvent(askForApproval(NO_APPROVAL, "ed", now), "Date clashes");
    expect(approvalState(rejected)).toBe("rejected");
    expect(rejected).toMatchObject({ approvalRequestedAt: null, rejectionNote: "Date clashes" });
    expect(approvalState(askForApproval(rejected, "ed", now))).toBe("pending");
    expect(() => rejectEvent(NO_APPROVAL, "x")).toThrow(/no request/);
    expect(() => approveEvent(NO_APPROVAL, "boss", now)).toThrow(/no request/);
  });

  it("schedules before the start only; cancels once", () => {
    expect(() => assertPublishAt(day("2026-11-10"), day("2026-11-10"))).toThrow(/before the event/);
    expect(() => assertPublishAt(null, day("2026-11-10"))).not.toThrow();
    const now = day("2026-11-01");
    const cancelled = cancelEvent({ cancelledAt: null }, "Speaker ill", now);
    expect(cancelled).toEqual({ cancelledAt: now, cancelReason: "Speaker ill" });
    expect(() => cancelEvent({ cancelledAt: now }, "again", now)).toThrow(/already cancelled/);
  });

  it("after-event fields: a typed number, a short note and an https recap link", () => {
    expect(
      EventAfterSchema.parse({ finalAttendance: 120, attendanceNote: "", recapUrl: "" }),
    ).toEqual({ finalAttendance: 120, attendanceNote: null, recapUrl: null });
    for (const bad of [
      { finalAttendance: -1 },
      { finalAttendance: 1.5 },
      { recapUrl: "javascript:alert(1)" },
      { extra: 1 },
    ]) {
      expect(
        EventAfterSchema.safeParse({ finalAttendance: 1, attendanceNote: "", recapUrl: "", ...bad })
          .success,
      ).toBe(false);
    }
  });
});
