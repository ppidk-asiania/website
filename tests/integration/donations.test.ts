import { beforeEach, describe, expect, it } from "vitest";
import { createSqlDonationStore, createSqlDonationWebStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createDonationActions } from "../../apps/admin/src/server/donations";
import { createDonationUpload } from "../../apps/web/src/server/donation-upload";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlDonationStore>[0];
const now = new Date("2026-11-26T05:00:00Z");
const staff = (userId: string, permissions: string[]): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const treasurer = staff("treasurer-1", ["finance.donations", "finance.export"]);
const context = () =>
  Promise.resolve({ actorEmail: "t@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

let fake: ReturnType<typeof fakeDb>;
let saved: string[];
let removed: string[];
let mails: string[];
let decided: string[];
let counter: number;
const db = () => fake.db as unknown as Db;
const admin = () =>
  createDonationActions({
    donations: createSqlDonationStore(db()),
    storage: { signedReadUrl: (path) => Promise.resolve(`https://files.test/${path}?sig=1`) },
    notify: {
      decided: (uid, id, verified) =>
        Promise.resolve(void decided.push(`${uid}:${id}:${verified}`)),
    },
    users: () =>
      Promise.resolve(new Map([["donor-1", { name: "=Evil Donor", email: "d@example.org" }]])),
    logExport: () => undefined,
  });
const web = () => createSqlDonationWebStore(db());
const upload = () =>
  createDonationUpload({
    donations: web(),
    storage: {
      save: (path) => Promise.resolve(void saved.push(path)),
      remove: (path) => Promise.resolve(void removed.push(path)),
    },
    send: (_message, key) => Promise.resolve(void mails.push(key)),
    now: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  });
const donor = (uid = "donor-1", name: string | null = "Siti") => ({
  uid,
  email: `${uid}@example.org`,
  name,
});
const send = (query: Record<string, string>, body: Uint8Array = pdf, who = donor()) =>
  upload()(
    who,
    new Request(`https://web.test/api/donations?${new URLSearchParams(query).toString()}`, {
      method: "POST",
      body: body as unknown as ArrayBuffer,
    }),
  );
const channelInput = (over: Record<string, unknown> = {}) => ({
  label: "BCA",
  details: "1234567 a.n. PPIDK",
  image: null,
  currency: "IDR",
  published: true,
  version: null,
  ...over,
});
let channelId = "";
const pending = () =>
  [...fake.docs.entries()].filter(([path]) => path.startsWith("donations/")) as Array<
    [string, Record<string, unknown>]
  >;
const cashEntries = () => [...fake.docs.keys()].filter((path) => path.startsWith("cashEntries/"));
/** Sends a donation as `donor-1` and returns its id. */
async function donate(query: Record<string, string> = {}, who = donor()) {
  const before = new Set(pending().map(([path]) => path));
  const response = await send({ channel: channelId, amount: "50000", ...query }, pdf, who);
  expect(response.status).toBe(201);
  return pending()
    .find(([path]) => !before.has(path))![0]
    .split("/")[1]!;
}

beforeEach(async () => {
  fake = fakeDb();
  saved = [];
  removed = [];
  mails = [];
  decided = [];
  counter = 0;
  fake.docs.set("settings/activePeriod", { periodId: "p1" });
  const created = await admin().saveChannel(...as(treasurer))(channelInput());
  if (!created.ok) throw new Error(JSON.stringify(created));
  channelId = created.data.id;
});

describe("donations (N5.4)", () => {
  it("a donation waits as pending with a private proof and the donor gets a receipt", async () => {
    const id = await donate({ message: "Semangat" });
    expect(fake.docs.get(`donations/${id}`)).toMatchObject({
      status: "pending",
      amountMinor: 5_000_000,
      currency: "IDR",
      userId: "donor-1",
      message: "Semangat",
    });
    expect(saved).toEqual([`donations/proofs/${id}.pdf`]);
    expect(mails).toEqual([`donation:${id}:received`]);
    expect(cashEntries()).toEqual([]);
  });

  it("verify writes ONE cash book line; a second verify writes nothing", async () => {
    const id = await donate();
    const a = admin();
    expect(await a.verify(...as(treasurer))({ id })).toEqual({ ok: true, data: { changed: true } });
    expect(await a.verify(...as(treasurer))({ id })).toEqual({
      ok: true,
      data: { changed: false },
    });
    expect(cashEntries()).toEqual([`cashEntries/${id}`]);
    expect(fake.docs.get(`cashEntries/${id}`)).toMatchObject({
      kind: "in",
      category: "donation",
      source: "donation",
      amountMinor: 5_000_000,
      currency: "IDR",
      periodId: "p1",
    });
    expect(fake.docs.get(`donations/${id}`)).toMatchObject({ status: "verified" });
    expect(decided).toEqual([`donor-1:${id}:true`]);
  });

  it("the verifier is never the donor", async () => {
    const id = await donate({}, donor("treasurer-1"));
    expect(await admin().verify(...as(treasurer))({ id })).toMatchObject({ error: "refused" });
    expect(await admin().reject(...as(treasurer))({ id, note: "no way" })).toMatchObject({
      error: "refused",
    });
    expect(cashEntries()).toEqual([]);
    expect(fake.docs.get(`donations/${id}`)).toMatchObject({ status: "pending" });
  });

  it("without an active period nothing is verified", async () => {
    const id = await donate();
    fake.docs.delete("settings/activePeriod");
    expect(await admin().verify(...as(treasurer))({ id })).toMatchObject({ error: "refused" });
    expect(fake.docs.get(`donations/${id}`)).toMatchObject({ status: "pending" });
    expect(cashEntries()).toEqual([]);
  });

  it("a rejected donation needs a reason, tells the donor and is not on the wall", async () => {
    const id = await donate({ name: "1" });
    const a = admin();
    expect(await a.reject(...as(treasurer))({ id, note: "x" })).toMatchObject({
      error: "invalid_input",
    });
    expect(await a.reject(...as(treasurer))({ id, note: "Blurry proof" })).toMatchObject({
      ok: true,
    });
    expect(fake.docs.get(`donations/${id}`)).toMatchObject({
      status: "rejected",
      note: "Blurry proof",
    });
    expect(await web().supporters()).toEqual([]);
    expect(cashEntries()).toEqual([]);
    expect(decided).toEqual([`donor-1:${id}:false`]);
    expect(await a.verify(...as(treasurer))({ id })).toMatchObject({ error: "refused" });
  });

  it("the wall shows the name only when chosen, never an amount; pending ones are not shown", async () => {
    const named = await donate({ name: "1" });
    const hidden = await donate({}, donor("donor-2", "Budi"));
    await donate({ name: "1" }, donor("donor-3", "Pending Person"));
    const a = admin();
    await a.verify(...as(treasurer))({ id: named });
    await a.verify(...as(treasurer))({ id: hidden });
    const wall = await web().supporters();
    expect(wall.map((s) => s.name ?? "(none)").sort()).toEqual(["(none)", "Siti"]);
    expect(JSON.stringify(wall)).not.toMatch(/amount|50000|Budi|Pending Person/);
  });

  it("choosing to show the name without having one stays anonymous", async () => {
    const id = await donate({ name: "1" }, donor("donor-1", null));
    expect(fake.docs.get(`donations/${id}`)).toMatchObject({ supporterName: null });
  });

  it("a hidden channel takes no new donation but keeps its past ones", async () => {
    const id = await donate();
    const saved1 = await admin().saveChannel(...as(treasurer))(
      channelInput({ id: channelId, version: 1, published: false }),
    );
    expect(saved1.ok).toBe(true);
    expect((await send({ channel: channelId, amount: "1000" })).status).toBe(404);
    expect(await web().channels()).toEqual([]);
    expect(await createSqlDonationStore(db()).list()).toMatchObject([{ id, channelId }]);
    expect(await admin().verify(...as(treasurer))({ id })).toMatchObject({ ok: true });
  });

  it("refuses a bad amount, a file that is not an image or PDF, and a missing sign-in", async () => {
    expect((await send({ channel: channelId, amount: "abc" })).status).toBe(400);
    expect((await send({ channel: channelId, amount: "0" })).status).toBe(400);
    expect(
      (await send({ channel: channelId, amount: "1000" }, new Uint8Array([1, 2, 3, 4]))).status,
    ).toBe(400);
    expect((await send({ channel: "missing", amount: "1000" })).status).toBe(404);
    const anonymous = await upload()(
      null,
      new Request("https://web.test/api/donations?channel=x&amount=1", {
        method: "POST",
        body: pdf as unknown as ArrayBuffer,
      }),
    );
    expect(anonymous.status).toBe(401);
    expect(pending()).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("needs finance.donations to manage and finance.export to export", async () => {
    const reader = staff("reader-1", ["finance.read"]);
    const id = await donate();
    expect(await admin().verify(...as(reader))({ id })).toMatchObject({ error: "forbidden" });
    expect(await admin().saveChannel(...as(reader))(channelInput())).toMatchObject({
      error: "forbidden",
    });
    expect((await admin().openProof(id, reader)).status).toBe(403);
    expect((await admin().exportCsv(reader)).status).toBe(403);
    expect((await admin().openProof(id, treasurer)).status).toBe(302);
    expect((await admin().openProof("missing", treasurer)).status).toBe(404);
  });

  it("exports a CSV with formulas defused", async () => {
    await donate({ name: "1" });
    const response = await admin().exportCsv(treasurer);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.split("\n")[0]).toBe("date,channel,currency,amount,status,donor,email,shown_as");
    expect(text).toContain('"\'=Evil Donor"');
    expect(text).toContain("IDR,50000.00,pending");
  });
});
