import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlLetterArchive, createSqlLetterTypeStore, deleteExpired } from "@website/db/sql";
import { can, normalizePermissions, type Principal } from "@website/permissions";
import { createLetterArchive } from "../../apps/web/src/server/letter-archive";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlLetterArchive>[0];
let fake: ReturnType<typeof fakeDb>;
let clock: Date;
let captchaOk: boolean;
const SECRET = "s".repeat(32);
const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
const guest = { name: "Arif", email: "arif@mail.com", institution: "UI", captcha: "token" };

const letter = (id: string, extra: Record<string, unknown> = {}) => ({
  periodId: "p1",
  place: "",
  attachmentNote: "",
  createdBy: "a",
  reviewedBy: null,
  reviewNote: null,
  secretary: null,
  coordinator: null,
  number: 1,
  cancelledAt: null,
  cancelReason: null,
  contentDigest: null,
  signers: [],
  signedBy: [],
  letterhead: null,
  archive: null,
  upload: null,
  placement: null,
  activityCode: null,
  topDeskOnly: false,
  initialsBox: false,
  draftUrl: null,
  sheetNumberTemplate: null,
  typeId: "sk",
  orgUnitId: "sekjen",
  orgUnitPath: ["sekjen"],
  subject: `Panitia ${id}`,
  body: "<p>secret body</p>",
  recipient: "Rahasia Penerima",
  letterDate: "2026-11-02",
  status: "issued",
  source: "editor",
  numberFormatted: `00${id}/SK/PPIDK-ASIANIA/XI/2026`,
  verificationCode: `CODE${id}-AAAAA`,
  issuedAt: new Date(`2026-11-0${id}T03:00:00Z`),
  deletedAt: null,
  version: 1,
  createdAt: clock,
  updatedAt: clock,
  ...extra,
});

const archive = (now = () => clock) =>
  createLetterArchive({
    archive: createSqlLetterArchive(fake.db as unknown as Db),
    captcha: () => Promise.resolve(captchaOk),
    secret: SECRET,
    now,
  });
const query = { q: "", typeId: null, year: null, page: 1 };

beforeEach(() => {
  fake = fakeDb();
  clock = new Date("2026-11-10T03:00:00Z");
  captchaOk = true;
  const type = (extra: Record<string, unknown>) => ({
    name: "Surat Keputusan",
    code: "SK",
    description: "",
    numberFormat: "{nomor}",
    numberPadding: 3,
    requiresCoordinator: false,
    requiresRecipient: true,
    contentPublic: true,
    publicArchive: true,
    active: true,
    sort: 0,
    version: 1,
    createdAt: clock,
    updatedAt: clock,
    deletedAt: null,
    ...extra,
  });
  fake.docs.set("letterTypes/sk", type({}));
  fake.docs.set(
    "letterTypes/priv",
    type({ name: "Surat Pribadi", code: "PR", publicArchive: false }),
  );
  fake.docs.set("letterTypes/old", type({ name: "Surat Lama", code: "OL", deletedAt: clock }));
  fake.docs.set("orgUnits/sekjen", { name: "Sekretariat Jenderal" });
  fake.docs.set("letters/l1", letter("1"));
  fake.docs.set("letters/l2", letter("2"));
  fake.docs.set("letters/draft", letter("3", { status: "draft", verificationCode: null }));
  fake.docs.set("letters/cancelled", letter("4", { status: "cancelled" }));
  fake.docs.set("letters/gone", letter("5", { deletedAt: clock }));
  fake.docs.set("letters/private", letter("6", { typeId: "priv" }));
  fake.docs.set("letters/oldtype", letter("7", { typeId: "old" }));
  fake.docs.set("letters/sheets", letter("8", { source: "certificate" }));
});

describe("public letter archive (14.3)", () => {
  it("lists only issued letters of public types, newest first, without the recipient or body", async () => {
    const pass = await archive().enter(guest, headers);
    if (!pass.ok) throw new Error("no pass");
    const result = await archive().list(pass.token, query);
    expect(result?.entries.map((e) => e.subject)).toEqual(["Panitia 2", "Panitia 1"]);
    expect(result?.entries[0]).toEqual({
      code: "CODE2-AAAAA",
      number: "002/SK/PPIDK-ASIANIA/XI/2026",
      letterDate: "2026-11-02",
      subject: "Panitia 2",
      typeId: "sk",
      typeName: "Surat Keputusan",
      unitName: "Sekretariat Jenderal",
    });
    const json = JSON.stringify(result);
    for (const secret of ["Rahasia", "secret body", "issuedAt", "Pribadi", "Lama"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("nothing is listed or read before the guest book is passed, or after the pass expired", async () => {
    const reads = vi.spyOn(fake.db, "collection");
    expect(await archive().list(undefined, query)).toBeNull();
    expect(await archive().list("garbage", query)).toBeNull();
    expect(await archive().list("a.b", query)).toBeNull();
    expect(reads.mock.calls.map(([name]) => name)).not.toContain("letters");
    const pass = await archive().enter(guest, headers);
    if (!pass.ok) throw new Error("no pass");
    expect(pass.maxAgeSeconds).toBe(3600);
    expect(await archive().list(pass.token, query)).not.toBeNull();
    const later = () => new Date(clock.getTime() + 3600_001);
    expect(await archive(later).list(pass.token, query)).toBeNull();
    const other = createLetterArchive({
      archive: createSqlLetterArchive(fake.db as unknown as Db),
      captcha: () => Promise.resolve(true),
      secret: "x".repeat(32),
      now: () => clock,
    });
    expect(await other.list(pass.token, query)).toBeNull();
  });

  it("a failed captcha or incomplete details refuse and store nothing", async () => {
    captchaOk = false;
    expect(await archive().enter(guest, headers)).toEqual({ ok: false, error: "captcha" });
    captchaOk = true;
    expect(await archive().enter({ ...guest, institution: "" }, headers)).toEqual({
      ok: false,
      error: "details",
    });
    expect(await archive().enter({ ...guest, extra: 1 }, headers)).toEqual({
      ok: false,
      error: "details",
    });
    expect([...fake.docs.keys()].filter((k) => k.startsWith("letterArchiveGuests/"))).toEqual([]);
  });

  it("the guest book keeps the visitor with a keyed IP hash and the cron job drops rows after a year", async () => {
    await archive().enter(guest, headers);
    const [key] = [...fake.docs.keys()].filter((k) => k.startsWith("letterArchiveGuests/"));
    const row = fake.docs.get(key as string) as Record<string, unknown>;
    expect(row).toMatchObject({ name: "Arif", email: "arif@mail.com", institution: "UI" });
    expect(row["ipHash"]).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    const guests = await createSqlLetterArchive(fake.db as unknown as Db).guests();
    expect(guests).toEqual([
      {
        id: expect.any(String),
        name: "Arif",
        email: "arif@mail.com",
        institution: "UI",
        at: clock,
      },
    ]);
    const year = new Date(clock.getTime() + 365 * 86_400_000);
    expect(
      (await deleteExpired(fake.db as unknown as Db, new Date(year.getTime() - 1)))
        .letterArchiveGuests,
    ).toBe(0);
    expect((await deleteExpired(fake.db as unknown as Db, year)).letterArchiveGuests).toBe(1);
  });

  it("no public type means an empty archive", async () => {
    fake.docs.set("letterTypes/sk", {
      ...(fake.docs.get("letterTypes/sk") as object),
      publicArchive: false,
    });
    const pass = await archive().enter(guest, headers);
    if (!pass.ok) throw new Error("no pass");
    expect((await archive().list(pass.token, query))?.total).toBe(0);
  });

  it("the type store keeps the switch off for old types", async () => {
    fake.docs.set("letterTypes/legacy", {
      ...(fake.docs.get("letterTypes/sk") as object),
      publicArchive: undefined,
    });
    const store = createSqlLetterTypeStore(fake.db as unknown as Db);
    expect((await store.get("legacy"))?.publicArchive).toBe(false);
  });

  it("only the guest-book permission opens the admin tab; letters.read alone does not", () => {
    const holder = (permissions: string[]): Principal => ({
      kind: "user",
      userId: "u",
      active: true,
      assignments: [
        {
          roleId: "r",
          scope: { type: "global" },
          permissions: new Set(normalizePermissions(permissions)),
        },
      ],
    });
    expect(can(holder(["letters.read"]), "letters.archive_guests")).toBe(false);
    expect(can(holder(["letters.archive_guests"]), "letters.archive_guests")).toBe(true);
  });
});
