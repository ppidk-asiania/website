import { describe, expect, it } from "vitest";
import {
  canUndoCheckIn,
  checkInOutcome,
  isPracticeTime,
  UNDO_WINDOW_MS,
} from "@website/domain/events";
import nextConfig from "../../apps/admin/next.config";

const at = new Date("2026-11-20T01:00:00Z");

describe("check-in rules (N1.4)", () => {
  it("only a confirmed, paid-up registration enters, once", () => {
    const base = { status: "confirmed", payment: "not_required", checkedInAt: null } as const;
    expect(checkInOutcome(base)).toBe("checked_in");
    expect(checkInOutcome({ ...base, payment: "verified" })).toBe("checked_in");
    expect(checkInOutcome({ ...base, checkedInAt: at })).toBe("already");
    expect(checkInOutcome({ ...base, status: "pending", payment: "unpaid" })).toBe("not_paid");
    expect(checkInOutcome({ ...base, payment: "rejected" })).toBe("not_paid");
    expect(checkInOutcome({ ...base, status: "waitlisted" })).toBe("waitlisted");
    expect(checkInOutcome({ ...base, status: "cancelled" })).toBe("cancelled");
  });

  it("undo window: 10 minutes for the person who checked in, any time for an editor", () => {
    const door = { userId: "d", canEditRegistrants: false };
    const checked = { by: "d", at };
    const at10 = new Date(at.getTime() + UNDO_WINDOW_MS);
    expect(canUndoCheckIn(checked, door, at10)).toBe(true);
    expect(canUndoCheckIn(checked, door, new Date(at10.getTime() + 1))).toBe(false);
    expect(canUndoCheckIn(checked, { ...door, userId: "other" }, at)).toBe(false);
    expect(canUndoCheckIn(checked, { ...door, userId: "x", canEditRegistrants: true }, at10)).toBe(
      true,
    );
  });

  it("practice lasts until the event day starts in the event's own time zone", () => {
    const event = { startsAt: new Date("2026-11-20T02:00:00Z"), timezone: "Asia/Tokyo" };
    expect(isPracticeTime(event, new Date("2026-11-19T14:59:00Z"))).toBe(true); // 23:59 on the 19th in Tokyo
    expect(isPracticeTime(event, new Date("2026-11-19T15:00:00Z"))).toBe(false); // midnight in Tokyo
    expect(isPracticeTime(event, new Date("2026-11-21T00:00:00Z"))).toBe(false);
  });

  it("only the door scanner page may use the camera", async () => {
    const rules = await nextConfig.headers!();
    const policy = (source: string) =>
      rules
        .filter((r) => r.source === source)
        .flatMap((r) => r.headers)
        .find((h) => h.key === "Permissions-Policy")?.value;
    expect(policy("/:path*")).toContain("camera=()");
    expect(policy("/events/:id/scan")).toContain("camera=(self)");
  });
});
