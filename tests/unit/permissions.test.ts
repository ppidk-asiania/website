import { describe, expect, it } from "vitest";
import { can, canAssignRole, requirePermission, type Principal } from "@platform/permissions";

const staff = (assignments: Principal["assignments"], active = true): Principal => ({
  kind: "staff",
  staffId: "s1",
  uid: "u1",
  active,
  assignments,
});

describe("permissions", () => {
  it("denies by default and for null/inactive principals", () => {
    expect(can(null, "events.read")).toBe(false);
    expect(
      can(staff([{ role: "superadmin", scope: { type: "global" } }], false), "events.read"),
    ).toBe(false);
    expect(can(staff([]), "events.read")).toBe(false);
  });

  it("grants granular permissions through roles", () => {
    const editor = staff([{ role: "editor", scope: { type: "global" } }]);
    expect(can(editor, "news.publish")).toBe(true);
    expect(can(editor, "users.manage")).toBe(false);
    expect(can(editor, "shop.refund")).toBe(false);
  });

  it("scopes chapter roles to their chapter", () => {
    const chapterEditor = staff([
      { role: "chapter_editor", scope: { type: "chapter", chapterId: "jp" } },
    ]);
    expect(can(chapterEditor, "events.write", { chapterId: "jp" })).toBe(true);
    expect(can(chapterEditor, "events.write", { chapterId: "au" })).toBe(false);
    expect(can(chapterEditor, "events.write")).toBe(false);
  });

  it("requirePermission throws for missing permission", () => {
    expect(() =>
      requirePermission(staff([{ role: "viewer", scope: { type: "global" } }]), "news.publish"),
    ).toThrow(/Missing permission/);
  });

  it("prevents privilege escalation when assigning roles", () => {
    const admin = staff([{ role: "admin", scope: { type: "global" } }]);
    const superadmin = staff([{ role: "superadmin", scope: { type: "global" } }]);
    expect(canAssignRole(admin, "editor")).toBe(false); // admin lacks users.manage
    expect(canAssignRole(superadmin, "superadmin")).toBe(true);
  });
});
