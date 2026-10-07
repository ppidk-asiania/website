import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConcurrencyConflictError } from "@website/domain/shared";
import type { Principal } from "@website/permissions";
import { createGuardedAction } from "../../apps/admin/src/server/guarded-action";

const editor: Principal = {
  kind: "user",
  userId: "u",
  active: true,
  assignments: [{ role: "editor", scope: { type: "global" } }],
};

describe("race conditions in admin writes", () => {
  it("a stale write (optimistic concurrency) returns 'conflict' instead of overwriting", async () => {
    const save = createGuardedAction({
      permission: "news.write",
      input: z.object({ id: z.string() }),
      handler: () => Promise.reject(new ConcurrencyConflictError("version changed")),
    });
    expect(await save(() => Promise.resolve(editor))({ id: "n1" })).toEqual({
      ok: false,
      error: "conflict",
    });
  });

  it("unexpected errors are not converted into messages for the client (framework shows a generic error)", async () => {
    const save = createGuardedAction({
      permission: "news.write",
      input: z.object({ id: z.string() }),
      handler: () => Promise.reject(new Error("db password=x")),
    });
    await expect(save(() => Promise.resolve(editor))({ id: "n1" })).rejects.toThrow();
  });
});
