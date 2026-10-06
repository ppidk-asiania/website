import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Principal } from "@platform/permissions";
import { createGuardedAction } from "../../apps/admin/src/server/guarded-action";
import { denyAllStaffDirectory } from "../../apps/admin/src/server/staff-directory";

const publishNews = createGuardedAction({
  permission: "news.publish",
  input: z.object({ id: z.string().min(1) }),
  handler: (input) => Promise.resolve({ published: input.id }),
});

const editor: Principal = {
  kind: "staff",
  staffId: "s",
  uid: "u",
  active: true,
  assignments: [{ role: "editor", scope: { type: "global" } }],
};
const viewer: Principal = {
  ...editor,
  assignments: [{ role: "viewer", scope: { type: "global" } }],
};

describe("admin guarded actions (server-side enforcement)", () => {
  it("rejects unauthenticated callers before validating input", async () => {
    expect(await publishNews(() => Promise.resolve(null))({ role: "superadmin" })).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it("rejects authenticated users without the permission, ignoring payload role fields", async () => {
    expect(
      await publishNews(() => Promise.resolve(viewer))({ id: "n1", role: "superadmin" }),
    ).toMatchObject({ error: "forbidden" });
  });

  it("validates input and runs the handler for permitted staff", async () => {
    expect(await publishNews(() => Promise.resolve(editor))({ id: "" })).toMatchObject({
      error: "invalid_input",
    });
    expect(await publishNews(() => Promise.resolve(editor))({ id: "n1" })).toEqual({
      ok: true,
      data: { published: "n1" },
    });
  });

  it("a Firebase login alone grants nothing (no staff record → no principal)", async () => {
    expect(await denyAllStaffDirectory.findPrincipalByUid("any-firebase-uid")).toBeNull();
  });
});
