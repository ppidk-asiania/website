import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEntity } from "@website/domain/events";
import type { Form, FormResponse } from "@website/domain/forms";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createEventCertificateActions } from "../../apps/admin/src/server/event-certificates";

const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "staff-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const writer = staff(["letters.edit", "events.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "e@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;

type Row = {
  userId: string;
  status: "confirmed" | "pending" | "waitlisted" | "cancelled";
  checkedInAt: Date | null;
};
const at = new Date("2026-11-20T02:00:00Z");
let rows: Row[] = [];
let settings = { formId: "ev", certificateNeedsAttendance: true } as Record<string, unknown>;
let evaluationForm: Partial<Form> = { respondents: "account", deletedAt: null };
let answered: string[] = [];
let onBatch: Array<{ emailHash: string | null }> = [];
const add = vi.fn((_batch: string, people: readonly { name: string }[]) =>
  Promise.resolve(people.length),
);

const actions = () =>
  createEventCertificateActions({
    certificates: { add, list: () => Promise.resolve(onBatch as never) },
    getLetter: () => Promise.resolve(null),
    hashEmail: (email) => `h:${email}`,
    events: { get: () => Promise.resolve({ id: "e1", deletedAt: null } as unknown as EventEntity) },
    registrations: { listForEvent: () => Promise.resolve(rows as never) },
    committees: {
      get: () =>
        Promise.resolve({
          evaluation: {
            committeeFormId: null,
            committeeOpensAt: null,
            committeeClosesAt: null,
            ...settings,
          },
        } as never),
    },
    forms: {
      get: () => Promise.resolve(evaluationForm as Form),
      listResponses: () => Promise.resolve(answered.map((uid) => ({ uid }) as FormResponse)),
    },
    users: (uids) =>
      Promise.resolve(
        new Map(
          uids.map((u) => [u, { name: u === "noname" ? null : `Name ${u}`, email: `${u}@x.org` }]),
        ),
      ),
    now: () => at,
  });
const run = (who: Principal = writer) =>
  actions().addFromEvent(...as(who))({ batchId: "b1", eventId: "e1" });

beforeEach(() => {
  add.mockClear();
  settings = { formId: "ev", certificateNeedsAttendance: true };
  evaluationForm = { respondents: "account", deletedAt: null };
  answered = ["done"];
  onBatch = [];
  rows = [
    { userId: "done", status: "confirmed", checkedIn: true },
    { userId: "absent", status: "confirmed", checkedIn: false },
    { userId: "silent", status: "confirmed", checkedIn: true },
    { userId: "waiting", status: "waitlisted", checkedIn: false },
    { userId: "gone", status: "cancelled", checkedIn: false },
  ].map(({ checkedIn, ...r }) => ({ ...r, checkedInAt: checkedIn ? at : null })) as Row[];
});

describe("certificate batch from an event (N1.7)", () => {
  it("adds exactly the people who attended and evaluated, and says who was left out and why", async () => {
    const result = await run();
    expect(result).toMatchObject({
      ok: true,
      data: {
        added: 1,
        leftOut: [
          { name: "Name absent", reason: "not_attended" },
          { name: "Name silent", reason: "not_evaluated" },
          { name: "Name waiting", reason: "not_confirmed" },
        ],
      },
    });
    expect(add.mock.calls[0]?.[1]).toEqual([
      { name: "Name done", note: null, emailHash: "h:done@x.org" },
    ]);
  });

  it("an event that does not need attendance adds the absent evaluator too", async () => {
    settings = { formId: "ev", certificateNeedsAttendance: false };
    answered = ["done", "absent"];
    const result = await run();
    expect(result).toMatchObject({ data: { added: 2 } });
  });

  it("an anonymous evaluation is never a condition (nobody knows who answered)", async () => {
    evaluationForm = { respondents: "anonymous", deletedAt: null };
    answered = [];
    const result = await run();
    expect(result).toMatchObject({
      data: {
        added: 2,
        leftOut: [
          { name: "Name absent", reason: "not_attended" },
          { name: "Name waiting", reason: "not_confirmed" },
        ],
      },
    });
  });

  it("does not add a person twice and skips an account without a name", async () => {
    onBatch = [{ emailHash: "h:done@x.org" }];
    rows.push({ userId: "noname", status: "confirmed", checkedInAt: at });
    answered = ["done", "noname"];
    const result = await run();
    expect(add).not.toHaveBeenCalled();
    expect(result.ok && result.data).toEqual({
      added: 0,
      leftOut: [
        { name: "Name done", reason: "already_on_batch" },
        { name: "Name absent", reason: "not_attended" },
        { name: "Name silent", reason: "not_evaluated" },
        { name: "Name waiting", reason: "not_confirmed" },
        { name: "noname@x.org", reason: "no_name" },
      ],
    });
  });

  it("needs the registrants' rights next to letters.edit", async () => {
    expect(await run(staff(["letters.edit"]))).toMatchObject({ error: "refused" });
    expect(await run(staff(["events.edit"]))).toMatchObject({ error: "forbidden" });
  });
});
