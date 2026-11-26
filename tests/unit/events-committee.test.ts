import { describe, expect, it } from "vitest";
import {
  CommitteeInputSchema,
  committeeGaps,
  committeeLocked,
  committeeRole,
} from "@website/domain/events";

const division = (id: string, parentId: string | null = null, quota: number | null = null) => ({
  id,
  name: `Division ${id}`,
  parentId,
  quota,
  description: "",
});
const member = (userId: string | null, divisionId: string) => ({
  userId,
  name: userId ? "" : "Helper",
  divisionId,
  seat: "member" as const,
});
const committee = {
  divisions: [division("board"), division("door", null, 2)],
  members: [member("boss", "board"), member("door-1", "door")],
};
const event = { startsAt: new Date("2026-11-20T02:00:00Z"), endsAt: null };

describe("committee rights (N1.5)", () => {
  it("the first division is the board, other seats are members, strangers get nothing", () => {
    const now = event.startsAt;
    expect(committeeRole(committee, "boss", event, now)).toBe("board");
    expect(committeeRole(committee, "door-1", event, now)).toBe("member");
    expect(committeeRole(committee, "stranger", event, now)).toBeNull();
    expect(committeeRole(null, "boss", event, now)).toBeNull();
  });

  it("rights end 14 days after the event (the end date when it has one)", () => {
    const day = 86_400_000;
    expect(committeeLocked(event, new Date(event.startsAt.getTime() + 14 * day))).toBe(false);
    expect(committeeLocked(event, new Date(event.startsAt.getTime() + 14 * day + 1))).toBe(true);
    const long = { ...event, endsAt: new Date(event.startsAt.getTime() + 3 * day) };
    expect(committeeLocked(long, new Date(event.startsAt.getTime() + 15 * day))).toBe(false);
    expect(
      committeeRole(committee, "boss", event, new Date(event.startsAt.getTime() + 15 * day)),
    ).toBeNull();
  });

  it("lists the divisions that still miss people", () => {
    expect(committeeGaps(committee)).toEqual([
      { id: "door", name: "Division door", filled: 1, quota: 2 },
    ]);
  });
});

describe("committee input", () => {
  const valid = { divisions: committee.divisions, members: committee.members };
  const refused = (input: unknown) => !CommitteeInputSchema.safeParse(input).success;

  it("accepts a normal committee", () => {
    expect(CommitteeInputSchema.safeParse(valid).success).toBe(true);
  });

  it("links a form once, at most four, and defaults to none", () => {
    expect(CommitteeInputSchema.parse(valid).applicationForms).toEqual([]);
    const link = { formId: "f1", kind: "volunteer" };
    expect(refused({ ...valid, applicationForms: [link, link] })).toBe(true);
    const many = ["a", "b", "c", "d", "e"].map((formId) => ({ formId, kind: "committee" }));
    expect(refused({ ...valid, applicationForms: many })).toBe(true);
    expect(refused({ ...valid, applicationForms: [{ formId: "f1", kind: "other" }] })).toBe(true);
  });

  it("gives a person one seat", () => {
    expect(refused({ ...valid, members: [member("boss", "board"), member("boss", "door")] })).toBe(
      true,
    );
  });

  it("refuses unknown divisions, duplicate ids, deeper nesting and a nested first division", () => {
    expect(refused({ ...valid, members: [member("x", "nowhere")] })).toBe(true);
    expect(refused({ ...valid, divisions: [division("a"), division("a")] })).toBe(true);
    expect(
      refused({
        ...valid,
        divisions: [division("a"), division("b", "a"), division("c", "b")],
        members: [],
      }),
    ).toBe(true);
    expect(refused({ divisions: [division("a", "b"), division("b")], members: [] })).toBe(true);
  });
});
