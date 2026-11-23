import { describe, expect, it } from "vitest";
import { createSqlApplicationStore, createSqlInterviewStore } from "@website/db/sql";
import type { ActiveSeat } from "@website/domain/organizations";
import { interviewScope } from "@website/domain/recruitment";
import { createInterviewReads } from "../../apps/admin/src/server/interviews";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlApplicationStore>[0];

const units = [
  { id: "dir", path: [] },
  { id: "finance", path: ["dir"] },
  { id: "media", path: ["dir"] },
];
const seat = (orgUnitId: string, kind: ActiveSeat["seat"]): ActiveSeat => ({
  orgUnitId,
  orgUnitPath: [...(units.find((u) => u.id === orgUnitId)?.path ?? []), orgUnitId],
  unitType: orgUnitId === "dir" ? "direktorat" : "divisi",
  seat: kind,
});
const seats: Record<string, ActiveSeat[]> = {
  "head-fin": [seat("finance", "head")],
  "head-dir": [seat("dir", "head")],
  "member-fin": [seat("finance", "member")],
};

const fake = fakeDb();
const app = (uid: string, choices: string[], status = "interview", slotId?: string) =>
  fake.docs.set(`applications/r1_${uid}`, {
    recruitmentId: "r1",
    userId: uid,
    status,
    choices,
    interviews: slotId
      ? { [choices[0] ?? ""]: { slotId, startsAt: new Date("2026-11-15T00:00:00Z") } }
      : {},
  });
app("ari", ["finance"]);
app("budi", ["media"]);
app("cici", ["media"], "interview", "fin-slot");
app("dedi", ["finance"], "submitted");
app("eko", ["finance"], "admin_rejected");
fake.docs.set("interviewSlots/fin-slot", {
  recruitmentId: "r1",
  interviewerUid: "head-fin",
  orgUnitId: null,
  startsAt: new Date("2026-11-15T00:00:00Z"),
  deletedAt: null,
});

const reads = createInterviewReads({
  applications: createSqlApplicationStore(fake.db as unknown as Db),
  interviews: createSqlInterviewStore(fake.db as unknown as Db),
  scope: (uid) =>
    Promise.resolve(
      interviewScope({
        seats: seats[uid] ?? [],
        units,
        review: uid === "committee",
        granted: [],
      }),
    ),
});
const ids = async (uid: string) => (await reads.applicants(uid, "r1")).map((a) => a.userId).sort();

describe("an interviewer opens only applicants in scope (11.5)", () => {
  it("lists applicants of the scope who passed the document check, and who booked my slot", async () => {
    expect(await ids("head-fin")).toEqual(["ari", "cici"]);
    expect(await ids("head-dir")).toEqual(["ari", "budi", "cici"]);
    expect(await ids("committee")).toEqual(["ari", "budi", "cici"]);
  });

  it("opens nobody for a member seat or a stranger", async () => {
    expect(await ids("member-fin")).toEqual([]);
    expect(await ids("stranger")).toEqual([]);
    expect(await reads.application("member-fin", "r1_ari")).toBeNull();
  });

  it("refuses another unit, an unreviewed or rejected applicant and a missing one", async () => {
    expect(await reads.application("head-fin", "r1_budi")).toBeNull();
    expect(await reads.application("head-fin", "r1_dedi")).toBeNull();
    expect(await reads.application("head-fin", "r1_eko")).toBeNull();
    expect(await reads.application("head-fin", "r1_nobody")).toBeNull();
    expect(await reads.application("head-fin", "../x")).toBeNull();
    expect((await reads.application("head-fin", "r1_ari"))?.userId).toBe("ari");
    expect((await reads.application("head-fin", "r1_cici"))?.userId).toBe("cici");
  });
});
