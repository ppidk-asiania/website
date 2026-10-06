import { describe, expect, it } from "vitest";
import * as audit from "@platform/audit";
import {
  buildRevertEvent,
  diffSnapshots,
  evaluateRevert,
  REVERT_WINDOW_MS,
  type AuditEvent,
} from "@platform/audit";

const DAY = 24 * 60 * 60 * 1000;
const base: AuditEvent = {
  id: "a1",
  occurredAt: new Date("2026-10-01T00:00:00Z"),
  actor: { type: "staff", id: "s1" },
  action: "news.update",
  resourceType: "news",
  resourceId: "n1",
  operationId: "op1",
  before: { title: "Old", meta: { tags: ["a"] } },
  after: { title: "New", meta: { tags: ["a", "b"] } },
  versionBefore: 3,
  versionAfter: 4,
  revertible: true,
  revertOf: null,
  request: { requestId: "r1" },
  prevHash: null,
  hash: null,
};

describe("audit", () => {
  it("diffs nested objects", () => {
    expect(diffSnapshots(base.before, base.after).map((c) => c.path)).toEqual([
      "meta.tags",
      "title",
    ]);
  });

  it("allows revert inside the 14-day window when versions match", () => {
    const now = new Date(base.occurredAt.getTime() + 13 * DAY);
    expect(evaluateRevert({ event: base, existingRevert: null, currentVersion: 4, now })).toEqual({
      allowed: true,
    });
  });

  it("rejects revert after 14 days, on concurrent edits, twice, or for non-revertible events", () => {
    const late = new Date(base.occurredAt.getTime() + REVERT_WINDOW_MS + 1);
    const now = new Date(base.occurredAt.getTime() + DAY);
    expect(
      evaluateRevert({ event: base, existingRevert: null, currentVersion: 4, now: late }),
    ).toMatchObject({ reason: "window_expired" });
    expect(
      evaluateRevert({ event: base, existingRevert: null, currentVersion: 5, now }),
    ).toMatchObject({ reason: "version_conflict" });
    expect(
      evaluateRevert({ event: base, existingRevert: base, currentVersion: 4, now }),
    ).toMatchObject({ reason: "already_reverted" });
    expect(
      evaluateRevert({
        event: { ...base, revertible: false },
        existingRevert: null,
        currentVersion: 4,
        now,
      }),
    ).toMatchObject({
      reason: "not_revertible",
    });
  });

  it("a revert produces a NEW event and leaves the original untouched", () => {
    const original = structuredClone(base);
    const revert = buildRevertEvent({
      original: base,
      id: "a2",
      operationId: "op2",
      actor: { type: "staff", id: "s2" },
      request: { requestId: "r2" },
      now: new Date(),
      currentVersion: 4,
    });
    expect(revert).toMatchObject({
      id: "a2",
      revertOf: "a1",
      before: base.after,
      after: base.before,
      versionAfter: 5,
    });
    expect(base).toEqual(original);
  });

  it("exposes no mutation/deletion API", () => {
    const names = Object.keys(audit).join(" ");
    expect(names).not.toMatch(/update|delete|remove|purge|edit/i);
  });
});
