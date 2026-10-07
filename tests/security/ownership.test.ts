import { describe, expect, it } from "vitest";
import { can, DEFAULT_ROLE_ASSIGNMENTS, type Principal } from "@website/permissions";

const alice: Principal = {
  kind: "user",
  userId: "alice-uid",
  active: true,
  assignments: DEFAULT_ROLE_ASSIGNMENTS,
};

describe("users are locked to their own uid", () => {
  it("own-data permissions only match the signed-in user's uid", () => {
    expect(can(alice, "profile.read_own", { ownerId: "alice-uid" })).toBe(true);
    expect(can(alice, "profile.read_own", { ownerId: "bob-uid" })).toBe(false);
    expect(can(alice, "registrations.read_own", { ownerId: "bob-uid" })).toBe(false);
    expect(can(alice, "shop.orders.read_own", {})).toBe(false);
  });

  it("a regular user cannot use any staff permission", () => {
    expect(can(alice, "members.read")).toBe(false);
    expect(can(alice, "admin.access")).toBe(false);
  });
});
