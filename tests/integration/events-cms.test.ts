import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlEventReader,
  createSqlEventStore,
  createSqlRegistrationStore,
  eventSnapshot,
} from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { REVERTIBLE_COLLECTIONS } from "../../apps/admin/src/server/audit-log";
import { createEventActions } from "../../apps/admin/src/server/events";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlEventStore>[0];
let now = new Date("2026-10-18T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "editor-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const editor = staff(["events.edit", "events.publish"]);
const writer = { ...staff(["events.edit"]), userId: "writer-1" };
const reader = staff(["events.read"]);
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const image = {
  url: "https://storage.example/events/banners/a.webp",
  thumbUrl: "https://storage.example/events/banners/a_thumb.webp",
  path: "events/banners/a.webp",
  thumbPath: "events/banners/a_thumb.webp",
  width: 2400,
  height: 1200,
};
const event = {
  title: "Simposium 2026",
  type: "seminar",
  startsAt: "2026-11-20T02:00:00.000Z",
  timezone: "Asia/Tokyo",
  registrationClosesAt: null,
  location: "Tokyo",
  description: "Simposium tahunan.",
  bannerImage: image,
  registrationUrl: "",
  slug: "",
  schedule: [{ time: "09:00", title: "Pembukaan", description: "" }],
  speakers: [
    { name: "Dr. Sari", description: "Peneliti", photo: image },
    { name: "Budi", description: "", photo: null },
  ],
  sponsors: [
    { logo: null, caption: "Sponsor A" },
    { logo: image, caption: "Sponsor B" },
  ],
};

let fake: ReturnType<typeof fakeDb>;
let store: ReturnType<typeof createSqlEventStore>;
const told: string[] = [];
const actions = () =>
  createEventActions({
    events: store,
    releaseReservations: () => Promise.resolve(),
    notify: {
      approvalAsked: (e) => Promise.resolve(void told.push(`asked:${e.id}`)),
      approvalDecided: (e, approved, by) =>
        Promise.resolve(void told.push(`${approved ? "approved" : "rejected"}:${e.id}:${by}`)),
      cancelled: (e) => Promise.resolve(void told.push(`cancelled:${e.id}`)),
    },
    now: () => now,
    uuid: () => "3f2a9c1e-0000-4000-8000-000000000000",
  });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);

beforeEach(() => {
  told.length = 0;
  fake = fakeDb();
  store = createSqlEventStore(fake.db as unknown as Db);
});

describe("Events CMS: save, publish, delete", () => {
  it("saves a draft with a random slug, sponsor order numbers and a CREATE entry", async () => {
    expect(
      await actions().save(...as(reader))({ ...event, version: null, publish: false }),
    ).toEqual({ ok: false, error: "forbidden" });
    const result = await actions().save(...as(editor))({ ...event, version: null, publish: false });
    expect(result).toMatchObject({ ok: true, data: { slug: "event-3f2a9c1e", version: 1 } });
    const saved = await store.get(result.ok ? result.data.id : "");
    expect(saved).toMatchObject({
      published: false,
      registrationUrl: null,
      type: "seminar",
      chapterId: null,
    });
    expect(saved?.sponsors.map((s) => [s.order, s.caption])).toEqual([
      [1, "Sponsor A"],
      [2, "Sponsor B"],
    ]);
    expect(auditEntries()).toEqual([
      expect.objectContaining({ action: "CREATE", module: "events", resourceType: "event" }),
    ]);
  });

  it("refuses a deadline after the event date and a URL already in use", async () => {
    expect(
      await actions().save(...as(editor))({
        ...event,
        registrationClosesAt: "2026-11-21T00:00:00.000Z",
        version: null,
        publish: false,
      }),
    ).toMatchObject({
      error: "invalid_input",
      fields: { registrationClosesAt: "The deadline must be on or before the event date." },
    });
    await actions().save(...as(editor))({
      ...event,
      slug: "simposium",
      version: null,
      publish: true,
    });
    expect(
      await actions().save(...as(editor))({
        ...event,
        slug: "simposium",
        version: null,
        publish: true,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("already used")] });
  });

  it("publish now, edit (version check), unpublish, then soft delete keeps registrations", async () => {
    const created = await actions().save(...as(editor))({
      ...event,
      slug: "simposium",
      version: null,
      publish: true,
    });
    const id = created.ok ? created.data.id : "";
    expect(await store.findBySlug("simposium")).toMatchObject({ published: true });
    expect(
      await actions().save(...as(editor))({ ...event, id, version: 9, publish: true }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await actions().save(...as(editor))({
        ...event,
        id,
        slug: "simposium-2026",
        version: 1,
        publish: true,
      }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", revertible: false });
    expect(
      await actions().setPublished(...as(editor))({ id, version: 2, published: false }),
    ).toMatchObject({ ok: true, data: { version: 3 } });
    expect(
      await actions().setPublished(...as(editor))({ id, version: 3, published: true }),
    ).toMatchObject({ ok: true });
    fake.docs.set(`eventRegistrations/${id}_u1`, {
      eventId: id,
      userId: "u1",
      status: "confirmed",
    });
    expect(await actions().remove(...as(editor))({ id, version: 4 })).toMatchObject({ ok: true });
    expect(await store.findBySlug("simposium-2026")).toBeNull();
    expect(await store.listForAdmin()).toEqual([]);
    expect(fake.docs.get(`eventRegistrations/${id}_u1`)).toMatchObject({ status: "confirmed" });
    expect(auditEntries().map((e) => e["action"])).toEqual([
      "CREATE",
      "UPDATE",
      "UNPUBLISH",
      "PUBLISH",
      "DELETE",
    ]);
    expect(auditEntries().at(-1)).toMatchObject({ after: null, revertible: true });
    expect(REVERTIBLE_COLLECTIONS["event"]).toBe("events");
  });

  it("publishing a saved draft from the form is a PUBLISH; the admin list is newest first", async () => {
    const first = await actions().save(...as(editor))({
      ...event,
      slug: "a",
      version: null,
      publish: false,
    });
    const id = first.ok ? first.data.id : "";
    await actions().save(...as(editor))({ ...event, slug: "a", id, version: 1, publish: true });
    expect(auditEntries().map((e) => e["action"])).toEqual(["CREATE", "PUBLISH"]);
    expect((await store.listForAdmin()).map((e) => e.id)).toEqual([id]);
    expect(await store.get("bad/id")).toBeNull();
    const saved = await store.get(id);
    expect(eventSnapshot({ ...saved!, bannerImage: null })["bannerImage"]).toBeNull();
  });
});

describe("Events life cycle (N1.1, DEC-25)", () => {
  const save = (p: Principal, extra: Record<string, unknown> = {}) =>
    actions().save(...as(p))({ ...event, slug: "sim", version: null, publish: false, ...extra });
  const draftId = async () => {
    const created = await save(writer);
    return created.ok ? created.data.id : "";
  };
  const versionOf = async (id: string) => (await store.get(id))?.version ?? 0;
  const ref = async (id: string) => ({ id, version: await versionOf(id) });

  it("an editor without events.publish cannot make an event public, by form or by button", async () => {
    expect(await save(writer, { publish: true })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("Ask for approval")],
    });
    const id = await draftId();
    expect(
      await actions().setPublished(...as(writer))({ ...(await ref(id)), published: true }),
    ).toMatchObject({ error: "refused" });
    expect((await store.get(id))?.published).toBe(false);
  });

  it("ask -> reject -> ask -> approve -> schedule; each decision tells the asker", async () => {
    const id = await draftId();
    expect(await actions().requestApproval(...as(writer))(await ref(id))).toMatchObject({
      ok: true,
    });
    expect(await actions().requestApproval(...as(writer))(await ref(id))).toMatchObject({
      error: "refused",
    });
    expect(
      await actions().setPublished(...as(editor))({ ...(await ref(id)), published: true }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("Decide the approval")] });
    expect(
      await actions().reject(...as(writer))({ ...(await ref(id)), note: "Date clashes" }),
    ).toMatchObject({ error: "forbidden" });
    expect(
      await actions().reject(...as(editor))({ ...(await ref(id)), note: "Date clashes" }),
    ).toMatchObject({ ok: true });
    expect(await store.get(id)).toMatchObject({
      rejectionNote: "Date clashes",
      approvalRequestedAt: null,
    });
    await actions().requestApproval(...as(writer))(await ref(id));
    expect(await actions().approve(...as(editor))(await ref(id))).toMatchObject({ ok: true });
    expect(told).toEqual([
      `asked:${id}`,
      `rejected:${id}:writer-1`,
      `asked:${id}`,
      `approved:${id}:writer-1`,
    ]);

    // Approved: the editor may now schedule it; the page stays hidden until the time.
    const publishAt = "2026-11-01T00:00:00.000Z";
    expect(
      await actions().setPublished(...as(writer))({
        ...(await ref(id)),
        published: true,
        publishAt,
      }),
    ).toMatchObject({ ok: true });
    expect(await store.get(id)).toMatchObject({ published: true, approvedBy: "editor-1" });
    const reader = createSqlEventReader(fake.db as unknown as Db);
    expect(await reader.findPublishedBySlug("sim", new Date("2026-10-31T00:00:00Z"))).toBeNull();
    expect(await reader.findPublishedBySlug("sim", new Date("2026-11-01T00:00:00Z"))).toMatchObject(
      { slug: "sim" },
    );
    expect(await reader.listPublished(10, new Date("2026-10-31T00:00:00Z"))).toEqual([]);
  });

  it("a board member who publishes approves by doing so; approval is for the idea", async () => {
    const created = await save(editor, { publish: true });
    const id = created.ok ? created.data.id : "";
    expect(await store.get(id)).toMatchObject({ approvedBy: "editor-1", published: true });
    // A later edit by a plain editor needs no second approval and keeps the event public.
    expect(
      await actions().save(...as(writer))({
        ...event,
        slug: "sim",
        id,
        version: 1,
        publish: true,
        title: "Simposium 2026 (updated)",
      }),
    ).toMatchObject({ ok: true });
    expect(await store.get(id)).toMatchObject({ published: true, approvedBy: "editor-1" });
  });

  it("refuses a publish time on or after the start", async () => {
    expect(await save(editor, { publish: true, publishAt: event.startsAt })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("before the event starts")],
    });
  });

  it("cancel keeps the page, tells registrants once and cannot be repeated", async () => {
    const created = await save(editor, { publish: true });
    const id = created.ok ? created.data.id : "";
    expect(
      await actions().cancel(...as(writer))({ ...(await ref(id)), reason: "x" }),
    ).toMatchObject({ error: "invalid_input" });
    expect(
      await actions().cancel(...as(writer))({ ...(await ref(id)), reason: "Speaker is ill" }),
    ).toMatchObject({ ok: true });
    expect(told).toEqual([`cancelled:${id}`]);
    expect(await store.get(id)).toMatchObject({ cancelReason: "Speaker is ill", published: true });
    expect(
      await actions().cancel(...as(writer))({ ...(await ref(id)), reason: "Speaker is ill" }),
    ).toMatchObject({ error: "refused" });
    expect(told).toHaveLength(1);
  });

  it("the after-event facts are accepted only once the event has started", async () => {
    const created = await save(editor, { publish: true });
    const id = created.ok ? created.data.id : "";
    const after = {
      finalAttendance: 120,
      attendanceNote: "80 online, 40 on site",
      recapUrl: "https://example.org/recap",
    };
    expect(
      await actions().saveAfter(...as(writer))({ ...(await ref(id)), ...after }),
    ).toMatchObject({ error: "refused" });
    now = new Date("2026-11-21T00:00:00Z");
    expect(
      await actions().saveAfter(...as(writer))({ ...(await ref(id)), ...after }),
    ).toMatchObject({ ok: true });
    expect(await store.get(id)).toMatchObject(after);
    now = new Date("2026-10-18T05:00:00Z");
  });

  it("registrants of a cancelled event are those with a place or a waitlist spot", async () => {
    fake.docs.set("eventRegistrations/e1_a", { eventId: "e1", userId: "a", status: "confirmed" });
    fake.docs.set("eventRegistrations/e1_b", { eventId: "e1", userId: "b", status: "waitlisted" });
    fake.docs.set("eventRegistrations/e1_c", { eventId: "e1", userId: "c", status: "cancelled" });
    fake.docs.set("eventRegistrations/e2_d", { eventId: "e2", userId: "d", status: "confirmed" });
    const registrations = createSqlRegistrationStore(fake.db as unknown as Db);
    expect((await registrations.activeUserIds("e1")).sort()).toEqual(["a", "b"]);
  });
});
