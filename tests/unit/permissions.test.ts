import { describe, expect, it } from "vitest";
import {
  can,
  canAccessAdmin,
  canAssignRole,
  DEFAULT_ROLE_ASSIGNMENTS,
  requirePermission,
  type Principal,
} from "@website/permissions";

const user = (assignments: Principal["assignments"], active = true): Principal => ({
  kind: "user",
  userId: "u1",
  active,
  assignments,
});
const global = { type: "global" } as const;

describe("RBAC", () => {
  it("denies by default and for null/inactive principals", () => {
    expect(can(null, "events.read")).toBe(false);
    expect(can(user([{ role: "superadmin", scope: global }], false), "events.read")).toBe(false);
    expect(can(user([]), "events.read")).toBe(false);
  });

  it("one user pool: plain users and members are not staff", () => {
    expect(canAccessAdmin(user(DEFAULT_ROLE_ASSIGNMENTS))).toBe(false);
    expect(canAccessAdmin(user([{ role: "member", scope: global }]))).toBe(false);
    expect(canAccessAdmin(user([{ role: "viewer", scope: global }]))).toBe(true);
  });

  it("*_own permissions only apply to the user's own resources", () => {
    const u = user(DEFAULT_ROLE_ASSIGNMENTS);
    expect(can(u, "profile.write_own", { ownerId: "u1" })).toBe(true);
    expect(can(u, "profile.write_own", { ownerId: "someone-else" })).toBe(false);
    expect(can(u, "profile.write_own")).toBe(false);
    // even a superadmin edits OTHER people's data via admin permissions, not *_own
    expect(
      can(user([{ role: "superadmin", scope: global }]), "profile.write_own", { ownerId: "x" }),
    ).toBe(false);
  });

  it("grants granular permissions through roles", () => {
    const editor = user([{ role: "editor", scope: global }]);
    expect(can(editor, "news.publish")).toBe(true);
    expect(can(editor, "members.read_pii")).toBe(false);
    expect(can(editor, "users.manage")).toBe(false);
  });

  it("scopes chapter roles to their chapter, including member personal data", () => {
    const jp = user([{ role: "chapter_admin", scope: { type: "chapter", chapterId: "jp" } }]);
    expect(can(jp, "members.read_pii", { chapterId: "jp" })).toBe(true);
    expect(can(jp, "members.read_pii", { chapterId: "au" })).toBe(false);
    expect(can(jp, "members.export", { chapterId: "jp" })).toBe(false);
  });

  it("requirePermission throws for missing permission", () => {
    expect(() =>
      requirePermission(user([{ role: "viewer", scope: global }]), "news.publish"),
    ).toThrow(/Missing permission/);
  });

  it("prevents privilege escalation when assigning roles", () => {
    const admin = user([{ role: "admin", scope: global }]);
    const superadmin = user([{ role: "superadmin", scope: global }]);
    expect(canAssignRole(admin, "editor")).toBe(false); // admin lacks users.manage
    expect(canAssignRole(superadmin, "superadmin")).toBe(true);
    expect(canAssignRole(superadmin, "member")).toBe(true);
  });
});
