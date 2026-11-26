import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSqlEventStore,
  createSqlFormStore,
  createSqlRegistrationStore,
} from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createEventActions } from "../../apps/admin/src/server/events";
import { createEventRegistrationActions } from "../../apps/admin/src/server/event-registration";
import { createFormActions } from "../../apps/admin/src/server/forms";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlEventStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
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
const editor = staff(["events.edit", "events.publish", "forms.edit", "forms.publish"]);
const reader = staff(["events.read", "registrants.read"]);
const context = () =>
  Promise.resolve({ actorEmail: "x@example.org", requestId: "req-123456", authTime: null });
const as = (p: Principal) => [() => Promise.resolve(p), context] as const;

const image = {
  url: "https://storage.example/a.webp",
  thumbUrl: "https://storage.example/a_thumb.webp",
  path: "events/banners/a.webp",
  thumbPath: "events/banners/a_thumb.webp",
  width: 2400,
  height: 1200,
};
const eventInput = {
  title: "Simposium 2026",
  type: "seminar",
  startsAt: "2026-11-20T02:00:00.000Z",
  timezone: "Asia/Tokyo",
  registrationClosesAt: null,
  location: "Tokyo",
  description: "D",
  bannerImage: image,
  registrationUrl: "",
  slug: "simposium",
  schedule: [],
  speakers: [],
  sponsors: [],
};
const formInput = (respondents: string) => ({
  title: `Form ${respondents}`,
  description: "",
  usage: "public",
  respondents,
  profileFields: [],
  opensAt: null,
  closesAt: null,
  questions: [
    {
      id: "",
      type: "single_choice",
      label: "T-shirt size",
      description: "",
      required: true,
      options: ["S", "M"],
      allowOther: false,
      maxSelections: null,
      min: null,
      max: null,
    },
  ],
  version: null,
});

let seat: "board" | "member" | null = null;
let fake: ReturnType<typeof fakeDb>;
let events: ReturnType<typeof createSqlEventStore>;
let formStore: ReturnType<typeof createSqlFormStore>;
const shorten = vi.fn((_url: string, _title: string) =>
  Promise.resolve(`https://s.id/reg${shorten.mock.calls.length}`),
);
const registrationActions = () =>
  createEventRegistrationActions({
    events,
    forms: formStore,
    registrations: createSqlRegistrationStore(fake.db as unknown as Db),
    users: (uids) =>
      Promise.resolve(
        new Map(uids.map((uid) => [uid, { name: `Name ${uid}`, email: `${uid}@example.org` }])),
      ),
    shorten,
    committeeRole: () => Promise.resolve(seat),
    storage: {
      signedReadUrl: (path) => Promise.resolve(`https://web.test/private-files?t=${path}`),
    },
    notify: { paymentDecided: () => Promise.resolve() },
    uuid: () => crypto.randomUUID(),
    webUrl: "https://ppi.example.org",
    now: () => now,
  });
const formActions = () =>
  createFormActions({
    forms: formStore,
    now: () => now,
    uuid: () => crypto.randomUUID(),
    token: () => "token00000000000000000001",
    logExport: () => undefined,
  });

let eventId = "";
let accountForm = "";
let guestForm = "";
const setup = (formId: string) => ({
  formId,
  attendanceModes: ["online", "onsite"],
  showOnTicket: "Bring your passport",
});
const ref = async () => ({ id: eventId, version: (await events.get(eventId))?.version ?? 0 });

beforeEach(async () => {
  shorten.mockClear();
  seat = null;
  fake = fakeDb();
  events = createSqlEventStore(fake.db as unknown as Db);
  formStore = createSqlFormStore(fake.db as unknown as Db);
  const event = await createEventActions({
    events,
    releaseReservations: () => Promise.resolve(),
    notify: {
      approvalAsked: () => Promise.resolve(),
      approvalDecided: () => Promise.resolve(),
      cancelled: () => Promise.resolve(),
    },
    now: () => now,
    uuid: () => "u",
  }).save(...as(editor))({ ...eventInput, version: null, publish: true });
  eventId = event.ok ? event.data.id : "";
  const make = async (respondents: string) => {
    const saved = await formActions().save(...as(editor))(formInput(respondents));
    return saved.ok ? saved.data.id : "";
  };
  accountForm = await make("account");
  guestForm = await make("guest");
});

describe("the questions of an event (admin, N1.2)", () => {
  it("links an account form with the modes, and unlinking returns to one-click registration", async () => {
    expect(
      await registrationActions().save(...as(reader))({
        ...(await ref()),
        setup: setup(accountForm),
      }),
    ).toMatchObject({ error: "forbidden" });
    expect(
      await registrationActions().save(...as(editor))({
        ...(await ref()),
        setup: setup(accountForm),
      }),
    ).toMatchObject({ ok: true });
    expect((await events.get(eventId))?.registration).toEqual({
      ...setup(accountForm),
      shortUrl: null,
    });
    expect(
      await registrationActions().save(...as(editor))({ ...(await ref()), setup: null }),
    ).toMatchObject({ ok: true });
    expect((await events.get(eventId))?.registration).toBeNull();
  });

  it("refuses a form that is missing, or answered without an account", async () => {
    for (const formId of ["missing-form", guestForm]) {
      expect(
        await registrationActions().save(...as(editor))({ ...(await ref()), setup: setup(formId) }),
      ).toMatchObject({ error: "refused" });
    }
    expect(
      await registrationActions().save(...as(editor))({
        ...(await ref()),
        setup: { ...setup(accountForm), attendanceModes: ["online", "online"] },
      }),
    ).toMatchObject({ error: "invalid_input" });
  });

  it("makes the short link once and reuses it; no link without a form or without an answer", async () => {
    expect(await registrationActions().shortLink(...as(editor))(await ref())).toMatchObject({
      error: "refused",
    });
    await registrationActions().save(...as(editor))({
      ...(await ref()),
      setup: setup(accountForm),
    });
    shorten.mockResolvedValueOnce("https://ppi.example.org/events/simposium/register");
    expect(await registrationActions().shortLink(...as(editor))(await ref())).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("did not answer")],
    });
    const first = await registrationActions().shortLink(...as(editor))(await ref());
    expect(first).toMatchObject({ ok: true, data: { shortUrl: "https://s.id/reg2" } });
    const again = await registrationActions().shortLink(...as(editor))(await ref());
    expect(again).toMatchObject({ ok: true, data: { shortUrl: "https://s.id/reg2" } });
    expect(shorten).toHaveBeenCalledTimes(2);
    expect(shorten).toHaveBeenLastCalledWith(
      "https://ppi.example.org/events/simposium/register",
      "Registration: Simposium 2026",
    );
    // A later change of the setup keeps the link.
    await registrationActions().save(...as(editor))({
      ...(await ref()),
      setup: setup(accountForm),
    });
    expect((await events.get(eventId))?.registration?.shortUrl).toBe("https://s.id/reg2");
  });

  it("lists registrants with their answers next to them (registrants.read)", async () => {
    await registrationActions().save(...as(editor))({
      ...(await ref()),
      setup: setup(accountForm),
    });
    const version = await formStore.getVersion(accountForm, 1);
    const q = version?.questions[0]?.id ?? "";
    fake.docs.set(`eventRegistrations/${eventId}_u1`, {
      eventId,
      userId: "u1",
      status: "confirmed",
      attendanceMode: "online",
      createdAt: now,
    });
    fake.docs.set(`eventRegistrations/${eventId}_u2`, {
      eventId,
      userId: "u2",
      status: "waitlisted",
      createdAt: new Date(now.getTime() + 1000),
    });
    fake.docs.set(`formResponses/${accountForm}_u1`, {
      formId: accountForm,
      version: 1,
      uid: "u1",
      answers: { [q]: "M" },
      submittedAt: now,
    });
    expect(
      await registrationActions().registrants(...as(staff(["events.read"])))({ eventId }),
    ).toMatchObject({ error: "forbidden" });
    const result = await registrationActions().registrants(...as(reader))({ eventId });
    expect(result).toMatchObject({
      ok: true,
      data: {
        columns: ["T-shirt size"],
        rows: [
          {
            userId: "u1",
            name: "Name u1",
            email: "u1@example.org",
            status: "confirmed",
            attendanceMode: "online",
            answers: ["M"],
          },
          { userId: "u2", status: "waitlisted", attendanceMode: null, answers: [""] },
        ],
      },
    });
  });

  it("a committee seat sees the short list; only the event board sees everything (N1.5)", async () => {
    await registrationActions().save(...as(editor))({
      ...(await ref()),
      setup: setup(accountForm),
    });
    fake.docs.set(`eventRegistrations/${eventId}_u1`, {
      eventId,
      userId: "u1",
      status: "confirmed",
      attendanceMode: "online",
      createdAt: now,
    });
    const noRights = staff(["events.read"]);
    seat = "member";
    const short = await registrationActions().registrants(...as(noRights))({ eventId });
    expect(short).toMatchObject({
      ok: true,
      data: { columns: [], rows: [{ userId: "u1", name: "Name u1", email: "" }] },
    });
    expect(JSON.stringify(short)).not.toContain("example.org");
    seat = "board";
    expect(await registrationActions().registrants(...as(noRights))({ eventId })).toMatchObject({
      ok: true,
      data: { rows: [{ userId: "u1", email: "u1@example.org" }] },
    });
    seat = null;
    expect(await registrationActions().registrants(...as(noRights))({ eventId })).toMatchObject({
      error: "forbidden",
    });
  });

  it("an event with no form lists its registrants without answer columns", async () => {
    fake.docs.set(`eventRegistrations/${eventId}_u1`, {
      eventId,
      userId: "u1",
      status: "confirmed",
      createdAt: now,
    });
    expect(await registrationActions().registrants(...as(reader))({ eventId })).toMatchObject({
      ok: true,
      data: { columns: [], rows: [{ userId: "u1", answers: [] }] },
    });
  });
});
