import { describe, expect, it } from "vitest";
import { wahaChannel } from "../../apps/admin/src/server/whatsapp";
import { createGroupBot } from "../../apps/admin/src/server/whatsapp-group";
import { createRecruitmentActions } from "../../apps/admin/src/server/recruitment";
import { createApplying } from "../../apps/web/src/server/recruitment";
import { createGroupNotice } from "../../apps/web/src/server/group-notice";
import {
  createSqlGroupNoticeReader,
  createSqlMemberProfileStore,
  createSqlRecruitmentStore,
} from "@website/db/sql";
import {
  interviewScope,
  recruitmentRecap,
  type Application,
  type Recruitment,
} from "@website/domain/recruitment";
import { createMemoryRateLimitStore } from "@website/security";
import { normalizePermissions, type Principal } from "@website/permissions";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlRecruitmentStore>[0];
const now = new Date("2026-11-16T05:00:00Z");
const GROUP = "120363041@g.us";
const config = { baseUrl: "https://waha.example/", apiKey: "k", session: "default" };

describe("WAHA channel: recipient kind group", () => {
  const sendWith = (message: Parameters<ReturnType<typeof wahaChannel>["send"]>[0]) => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve(Response.json({ id: "wamid.1" }));
    };
    return wahaChannel(config, fetchImpl as never)
      .send(message, "k:1")
      .then((result) => ({ result, body: bodies[0] }));
  };
  const group = { channel: "whatsapp" as const, to: GROUP, subject: "", text: "Halo", html: "" };

  it("sends plain text to the group chat id as it is", async () => {
    const { result, body } = await sendWith(group);
    expect(result).toEqual({ ok: true, providerId: "wamid.1" });
    expect(body).toMatchObject({ chatId: GROUP, text: "Halo" });
    expect(body).not.toHaveProperty("mentions");
  });

  it("mentions people by their numbers, added to the sent text only", async () => {
    const { body } = await sendWith({ ...group, mentions: ["+6281234567890"] });
    expect(body).toMatchObject({
      chatId: GROUP,
      text: "Halo\n@6281234567890",
      mentions: ["6281234567890@c.us"],
    });
  });
});

// ---- the keyword bot -------------------------------------------------------------------------
const units = [
  { id: "dir", path: [] },
  { id: "finance", path: ["dir"] },
  { id: "media", path: ["dir"] },
];
const recruitmentOf = (id: string, opens: string, closes: string, groupId = GROUP) =>
  ({
    id,
    title: `Oprec ${id}`,
    periodId: "p1",
    published: true,
    deletedAt: null,
    opensAt: new Date(opens),
    closesAt: new Date(closes),
    waGroup: { id: groupId, name: "Oprec" },
    units: [
      { orgUnitId: "finance", name: "Keuangan", quota: 2, portfolioRequired: false, seats: [] },
      { orgUnitId: "media", name: "Media", quota: 2, portfolioRequired: false, seats: [] },
    ],
  }) as unknown as Recruitment;
const app = (userId: string, choices: string[]): Application =>
  ({
    id: userId,
    recruitmentId: "x",
    userId,
    status: "submitted",
    choices,
    offer: null,
    interviews: {},
  }) as unknown as Application;
const origin = (campus: string) => ({
  chapter: "Japan",
  campus,
  level: "bachelor",
  entryYear: 2025,
  gender: "f",
});

// verified number -> account; seats decide the scope (the 11.5 rules)
const NUMBERS: Record<string, string> = {
  "6281000000001": "committee",
  "6281000000002": "head-fin",
  "6281000000003": "member-fin",
};
const seatsOf = (uid: string) =>
  uid === "head-fin"
    ? [{ orgUnitId: "finance", orgUnitPath: ["dir", "finance"], unitType: "divisi", seat: "head" }]
    : uid === "member-fin"
      ? [
          {
            orgUnitId: "finance",
            orgUnitPath: ["dir", "finance"],
            unitType: "divisi",
            seat: "member",
          },
        ]
      : [];

function setup(list: Recruitment[] = [recruitmentOf("r1", "2026-11-01", "2026-12-01")]) {
  const replies: Array<{ to: string; text: string; key: string }> = [];
  const seen = new Set<string>();
  const recapped: string[] = [];
  const bot = createGroupBot({
    record: (_provider, id) => Promise.resolve(!seen.has(id) && !!seen.add(id)),
    recruitments: () => Promise.resolve(list),
    senderUid: (number) => Promise.resolve(NUMBERS[number.slice(1)] ?? null),
    resolveLid: (lid) => Promise.resolve(lid === "555@lid" ? "+6281000000001" : null),
    scopeOf: (uid) =>
      Promise.resolve(
        interviewScope({
          seats: seatsOf(uid) as never,
          units,
          review: uid === "committee",
          granted: [],
        }),
      ),
    recap: (ids, scope) => {
      recapped.push(...ids);
      return Promise.resolve(
        recruitmentRecap({
          recruitments: [
            {
              recruitment: list.find((r) => r.id === ids[0]) as Recruitment,
              applications: [app("a", ["finance"]), app("b", ["media", "finance"])],
              assessments: [],
            },
          ],
          origins: new Map([
            ["a", origin("Todai")],
            ["b", origin("Kyoto")],
          ]),
          scope,
        }),
      );
    },
    rateLimits: createMemoryRateLimitStore(),
    reply: (to, text, key) => Promise.resolve(replies.push({ to, text, key })),
    logError: () => undefined,
    now: () => now,
  });
  let n = 0;
  const say = (
    text: string,
    from = "6281000000001@c.us",
    over: { group?: string; fromMe?: boolean } = {},
  ) =>
    bot({
      id: `m${n++}`,
      from: over.group ?? GROUP,
      fromMe: over.fromMe ?? false,
      text,
      participant: from,
    });
  return { say, replies, recapped, bot };
}

describe("group keywords", () => {
  it("answers /rekap in the configured group", async () => {
    const t = setup();
    await t.say("/rekap");
    expect(t.replies).toHaveLength(1);
    expect(t.replies[0]?.to).toBe(GROUP);
    expect(t.replies[0]?.text).toContain("Oprec r1");
    expect(t.replies[0]?.text).toContain("2 lamaran");
  });

  it("answers /bantuan to anyone, and ignores other text, other groups and its own messages", async () => {
    const t = setup();
    await t.say("/bantuan", "6289999999999@c.us");
    expect(t.replies[0]?.text).toContain("/rekap");
    await t.say("selamat pagi");
    await t.say("/rekap", undefined, { group: "99999999@g.us" });
    await t.say("/rekap", undefined, { fromMe: true });
    await t.say("/rekap", "6281000000001@c.us", { group: "6281000000001@c.us" });
    expect(t.replies).toHaveLength(1);
  });

  it("answers once per message even when WAHA delivers it twice", async () => {
    const t = setup();
    const message = {
      id: "same",
      from: GROUP,
      fromMe: false,
      text: "/rekap",
      participant: "6281000000001@c.us",
    };
    await t.bot(message);
    await t.bot(message);
    expect(t.replies).toHaveLength(1);
  });

  it("scope: global read sees all units, a head sees its unit, anyone else is refused", async () => {
    const t = setup();
    await t.say("/posisi");
    expect(t.replies[0]?.text).toMatch(/Keuangan[\s\S]*Media/);
    await t.say("/posisi", "6281000000002@c.us");
    expect(t.replies[1]?.text).toContain("Keuangan");
    expect(t.replies[1]?.text).not.toContain("Media");
    await t.say("/posisi", "6281000000003@c.us"); // a plain member seat
    await t.say("/posisi", "6285555555555@c.us"); // number not linked
    expect(t.replies[2]?.text).toMatch(/tidak punya akses/);
    expect(t.replies[3]?.text).toMatch(/tidak punya akses/);
    expect(t.replies[2]?.text).not.toContain("Keuangan");
  });

  it("knows a sender hidden behind a LID through WAHA", async () => {
    const t = setup();
    await t.say("/kampus", "555@lid");
    expect(t.replies[0]?.text).toContain("Todai");
  });

  it("answers for the recruitment accepting applications, else the one opened last", async () => {
    const t = setup([
      recruitmentOf("old", "2026-01-01", "2026-02-01"),
      recruitmentOf("open", "2026-11-01", "2026-12-01"),
      recruitmentOf("newer", "2026-03-01", "2026-04-01"),
    ]);
    await t.say("/rekap");
    expect(t.recapped).toEqual(["open"]);
    const closed = setup([
      recruitmentOf("old", "2026-01-01", "2026-02-01"),
      recruitmentOf("newer", "2026-03-01", "2026-04-01"),
    ]);
    await closed.say("/rekap");
    expect(closed.recapped).toEqual(["newer"]);
  });

  it("answers at most 20 times a minute per group", async () => {
    const t = setup();
    for (let i = 0; i < 25; i++) await t.say("/rekap");
    expect(t.replies).toHaveLength(20);
    await t.say("/rekap", undefined, { group: "777777777@g.us" });
    expect(t.replies).toHaveLength(20); // not configured: ignored, not counted
  });

  it("no answer holds a phone number, an e-mail or a score", async () => {
    const t = setup();
    for (const k of [
      "rekap",
      "posisi",
      "ppin",
      "kampus",
      "jenjang",
      "wawancara",
      "antrean",
      "tren",
      "bantuan",
    ]) {
      await t.say(`/${k}`);
    }
    expect(t.replies).toHaveLength(9);
    for (const { text } of t.replies) expect(text).not.toMatch(/@|\+\d|\d{9,}|skor|score/i);
  });
});

// ---- the committee sets the group --------------------------------------------------------------
describe("recruitment.waGroup", () => {
  const committee: Principal = {
    kind: "user",
    userId: "c1",
    active: true,
    assignments: [
      {
        roleId: "r",
        scope: { type: "global" },
        permissions: new Set(normalizePermissions(["recruitment.edit"])),
      },
    ],
  };
  const context = () =>
    Promise.resolve({ actorEmail: "oprec@example.org", requestId: "req-123456", authTime: null });

  it("saves, keeps it through an edit, and sends a test message to the group", async () => {
    const fake = fakeDb();
    fake.docs.set("periods/p1", { name: "2026", status: "active", deletedAt: null });
    fake.docs.set("orgUnits/finance", {
      periodId: "p1",
      name: "Keuangan",
      type: "divisi",
      path: [],
      deletedAt: null,
    });
    fake.docs.set("forms/f", { usage: "recruitment", currentVersion: 1, deletedAt: null });
    fake.docs.set("formVersions/f_1", { formId: "f", number: 1, answered: false, questions: [] });
    const sent: Array<{ to: string | null; text: string }> = [];
    const actions = createRecruitmentActions({
      recruitments: createSqlRecruitmentStore(fake.db as unknown as Db),
      send: (message) => Promise.resolve(sent.push(message) && ("logged" as const)),
      now: () => now,
    });
    const as = [() => Promise.resolve(committee), context] as const;
    const form = {
      periodId: "p1",
      title: "Oprec 2026",
      description: "",
      opensAt: "2026-11-01T00:00:00.000Z",
      closesAt: "2026-11-20T00:00:00.000Z",
      maxChoices: 1,
      offerDays: 3,
      formId: "f",
      units: [{ orgUnitId: "finance", quota: 2, portfolioRequired: false }],
    };
    const created = await actions.save(...as)({ ...form, version: null });
    if (!created.ok) throw new Error("expected saved");
    const set = await actions.saveWaGroup(...as)({
      id: created.data.id,
      version: created.data.version,
      group: { id: GROUP, name: "Panitia Oprec" },
    });
    if (!set.ok) throw new Error("expected group saved");
    expect(fake.docs.get(`recruitments/${created.data.id}`)?.["waGroup"]).toEqual({
      id: GROUP,
      name: "Panitia Oprec",
    });
    const edited = await actions.save(...as)({
      ...form,
      title: "Oprec 2026 v2",
      id: created.data.id,
      version: set.data.version,
    });
    if (!edited.ok) throw new Error("expected edit");
    expect(fake.docs.get(`recruitments/${created.data.id}`)?.["waGroup"]).toMatchObject({
      id: GROUP,
    });

    const bad = await actions.saveWaGroup(...as)({
      id: created.data.id,
      version: edited.data.version,
      group: { id: "6281234@c.us", name: "x" },
    });
    expect(bad.ok).toBe(false);

    const test = await actions.testWaGroup(...as)({ id: created.data.id });
    expect(test.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(GROUP);
    expect(sent[0]?.text).not.toMatch(/@|\+\d/);
  });
});

// ---- notices to the group ------------------------------------------------------------------------
const WEB = "https://web.example";
const recruitment = recruitmentOf("r1", "2026-11-01", "2026-12-01");
const application = (status = "submitted") =>
  ({
    id: "r1_siti",
    recruitmentId: "r1",
    userId: "siti",
    status,
    choices: ["finance", "media"],
    version: 4,
  }) as unknown as Application;

function noticeSetup(over: { group?: Recruitment["waGroup"]; heads?: string[] } = {}) {
  const sent: Array<{
    key: string;
    to: string | null;
    text: string;
    mentions?: readonly string[];
  }> = [];
  const asked: string[] = [];
  const notice = createGroupNotice({
    recruitment: () =>
      Promise.resolve({
        ...recruitment,
        ...(over.group !== undefined ? { waGroup: over.group } : {}),
      } as Recruitment),
    people: {
      applicant: () => Promise.resolve({ name: "Siti Rahma", campus: "Kyoto University" }),
      headNumbers: (_period, unit) => {
        asked.push(unit);
        return Promise.resolve(unit === "finance" ? (over.heads ?? ["+6281111111111"]) : []);
      },
    },
    send: (message, key) =>
      Promise.resolve(
        sent.push({ key, to: message.to, text: message.text, mentions: message.mentions }) &&
          ("sent" as const),
      ),
    webUrl: WEB,
  });
  return { notice, sent, asked };
}

describe("group notices", () => {
  it("submitted: name, campus, choices, link; mentions the heads; no number in the text", async () => {
    const t = noticeSetup();
    await t.notice({ kind: "submitted", application: application() });
    expect(t.sent).toHaveLength(1);
    const [m] = t.sent;
    expect(m?.to).toBe(GROUP);
    expect(m?.key).toBe("group:r1_siti:submitted:4");
    expect(m?.text).toContain("Siti Rahma");
    expect(m?.text).toContain("Kyoto University");
    expect(m?.text).toContain("Keuangan, Media");
    expect(m?.text).toContain(`${WEB}/recruitment/r1`);
    expect(m?.text).not.toMatch(/@|\+\d/);
    expect(m?.mentions).toEqual(["+6281111111111"]);
    expect(t.asked).toEqual(["finance", "media"]);
  });

  it("booked and cancelled name only the chosen unit's heads; each once", async () => {
    const t = noticeSetup();
    await t.notice({
      kind: "booked",
      application: application("interview"),
      choiceId: "finance",
      slotId: "s1",
    });
    await t.notice({
      kind: "booked",
      application: application("interview"),
      choiceId: "finance",
      slotId: "s1",
    });
    await t.notice({ kind: "cancelled", application: application("interview"), choiceId: "media" });
    expect(t.sent.map((m) => m.key)).toEqual([
      "group:r1_siti:booked:s1",
      "group:r1_siti:booked:s1",
      "group:r1_siti:cancelled:media:4",
    ]);
    expect(t.sent[0]?.text).toContain("Wawancara dipesan");
    expect(t.sent[0]?.mentions).toEqual(["+6281111111111"]);
    expect(t.sent[2]?.text).toContain("membatalkan");
    expect(t.sent[2]?.mentions).toEqual([]);
  });

  it("sends nothing when the recruitment has no group", async () => {
    const t = noticeSetup({ group: null });
    await t.notice({ kind: "submitted", application: application() });
    expect(t.sent).toEqual([]);
  });

  it("is sent after the commit and never undoes it", async () => {
    const order: string[] = [];
    const committed = application();
    const applying = (notifyGroup: () => Promise<void>) =>
      createApplying({
        store: {
          submit: () => {
            order.push("commit");
            return Promise.resolve({ ok: true, application: committed });
          },
          cancelInterview: () => Promise.resolve({ ok: true, application: committed }),
        } as never,
        profileComplete: () => Promise.resolve(true),
        hasProof: () => Promise.resolve(true),
        storage: { save: () => Promise.resolve({ url: null }) },
        notifyGroup: () => {
          order.push("notice");
          return notifyGroup();
        },
        now: () => now,
        uuid: () => "u",
      });
    const ok = await applying(() => Promise.resolve()).submit(
      { uid: "siti" },
      { recruitmentId: "r1" },
    );
    expect(ok).toMatchObject({ ok: true, status: "submitted" });
    expect(order).toEqual(["commit", "notice"]);
    const failed = await applying(() => Promise.reject(new Error("waha down"))).submit(
      { uid: "siti" },
      { recruitmentId: "r1" },
    );
    expect(failed).toMatchObject({ ok: true });
    const cancelled = await applying(() => Promise.reject(new Error("x"))).cancelInterview(
      { uid: "siti" },
      { recruitmentId: "r1", choiceId: "finance" },
    );
    expect(cancelled).toMatchObject({ ok: true });
  });
});

describe("heads of a unit and its parent (verified numbers only)", () => {
  it("mentions the head of the unit and of its parent, skipping unverified numbers", async () => {
    const fake = fakeDb();
    const set = (path: string, data: Record<string, unknown>) => fake.docs.set(path, data);
    set("orgUnits/dir", { path: [] });
    set("orgUnits/finance", { path: ["dir"] });
    const appointment = (id: string, userId: string, orgUnitId: string, seat = "head") =>
      set(`appointments/${id}`, { periodId: "p1", status: "active", userId, orgUnitId, seat });
    appointment("a1", "head-fin", "finance");
    appointment("a2", "head-dir", "dir");
    appointment("a3", "member-fin", "finance", "member");
    appointment("a4", "head-unverified", "finance");
    for (const uid of ["head-fin", "head-dir", "member-fin", "head-unverified"]) {
      set(`users/${uid}`, { status: "active" });
    }
    set("memberProfiles/head-fin", {
      whatsappNumber: "+6281000000002",
      whatsappVerifiedAt: now,
    });
    set("memberProfiles/head-dir", {
      whatsappNumber: "+6281000000009",
      whatsappVerifiedAt: now,
    });
    set("memberProfiles/member-fin", { whatsappNumber: "+6281000000003", whatsappVerifiedAt: now });
    set("memberProfiles/head-unverified", { whatsappNumber: "+6281000000004" });
    const reader = createSqlGroupNoticeReader(fake.db as unknown as Db);
    expect((await reader.headNumbers("p1", "finance")).sort()).toEqual([
      "+6281000000002",
      "+6281000000009",
    ]);
    expect(await reader.headNumbers("p1", "nowhere")).toEqual([]);
    set("memberProfiles/siti", { fullName: "Siti Rahma", university: "Kyoto University" });
    expect(await reader.applicant("siti")).toEqual({
      name: "Siti Rahma",
      campus: "Kyoto University",
    });
  });
});

describe("sender by verified number", () => {
  it("finds the account of a verified number only", async () => {
    const fake = fakeDb();
    const profiles = createSqlMemberProfileStore(fake.db as unknown as Db);
    fake.docs.set("memberProfiles/siti", { whatsappNumber: "+6281", whatsappVerifiedAt: now });
    fake.docs.set("memberProfiles/budi", { whatsappNumber: "+6282" });
    expect(await profiles.uidByVerifiedNumber("+6281")).toBe("siti");
    expect(await profiles.uidByVerifiedNumber("+6282")).toBeNull();
    expect(await profiles.uidByVerifiedNumber("+6283")).toBeNull();
  });
});
