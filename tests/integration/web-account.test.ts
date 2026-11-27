import { beforeEach, describe, expect, it } from "vitest";
import { createSqlSubmissionReader } from "@website/db/sql";
import { createSubmissions } from "../../apps/web/src/server/submissions";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlSubmissionReader>[0];
const now = new Date("2026-11-27T05:00:00Z");
const day = (d: number) => new Date(now.getTime() - d * 86_400_000);

let fake: ReturnType<typeof fakeDb>;

const event = (uid: string) =>
  uid === "u-1"
    ? [
        {
          status: "confirmed" as const,
          event: { id: "e1", slug: "simposium", title: "Simposium", startsAt: day(1) },
        },
      ]
    : [];
const loan = (uid: string) =>
  uid === "u-1"
    ? [{ id: "l1", itemName: "Speaker", status: "handed_over", createdAt: day(5) }]
    : [];
const submissionsOf = () =>
  createSubmissions({
    events: { listByUser: (uid: string) => Promise.resolve(event(uid)) } as never,
    loans: { mine: (uid: string) => Promise.resolve(loan(uid)) } as never,
    rows: createSqlSubmissionReader(fake.db as unknown as Db),
    now: () => now,
  });

beforeEach(() => {
  fake = fakeDb();
  const set = (key: string, data: Record<string, unknown>) => fake.docs.set(key, data);
  set("recruitments/r1", {
    periodId: "p1",
    title: "Oprec 2026",
    description: "",
    opensAt: day(30),
    closesAt: day(10),
    maxChoices: 2,
    units: [],
    offerDays: 3,
    formId: "f1",
    formVersion: 1,
    published: true,
    version: 1,
    createdAt: day(31),
    updatedAt: day(31),
    deletedAt: null,
  });
  for (const uid of ["u-1", "u-2"]) {
    set(`applications/r1_${uid}`, {
      recruitmentId: "r1",
      userId: uid,
      status: "interview",
      choices: [],
      answers: {},
      revisionRound: 0,
      version: 1,
      submittedAt: day(20),
      createdAt: day(21),
      updatedAt: day(20),
    });
    set(`formResponses/f1_${uid}`, { formId: "f1", uid, answers: {}, submittedAt: day(7) });
    set(`opportunityApplications/o1_${uid}`, {
      opportunityId: "o1",
      userId: uid,
      status: "interview",
      note: "staff only",
      createdAt: day(2),
    });
    set(`donations/d-${uid}`, {
      channelId: "c1",
      userId: uid,
      amountMinor: 50000,
      currency: "JPY",
      status: "pending",
      createdAt: day(3),
    });
  }
  set("forms/f1", { title: "Mentorship sign-up" });
  set("opportunities/o1", { title: "Summer internship" });
  set("donationChannels/c1", { label: "Bank transfer" });
});

describe("My submissions (N3.2)", () => {
  it("lists every kind of answer one account sent, newest first", async () => {
    const rows = await submissionsOf()("u-1");
    expect(rows.map((r) => [r.kind, r.title, r.state])).toEqual([
      ["event", "Simposium", "confirmed"],
      ["opportunity", "Summer internship", "interview"],
      ["donation", "Bank transfer", "pending"],
      ["loan", "Speaker", "handed_over"],
      ["form", "Mentorship sign-up", "sent"],
      ["recruitment", "Oprec 2026", "interview"],
    ]);
    expect(rows.find((r) => r.kind === "recruitment")?.next).toBe("interview");
    expect(rows.find((r) => r.kind === "donation")?.detail).toBe("JPY 50,000");
  });

  it("lists only the rows of the uid asked for, and nothing of anyone else", async () => {
    const rows = await submissionsOf()("u-2");
    expect(rows.map((r) => r.kind).sort()).toEqual([
      "donation",
      "form",
      "opportunity",
      "recruitment",
    ]);
    expect(await submissionsOf()("nobody")).toEqual([]);
  });

  it("never carries the staff note of an application", async () => {
    const rows = await submissionsOf()("u-1");
    expect(JSON.stringify(rows)).not.toContain("staff only");
  });
});
