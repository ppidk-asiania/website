import { beforeEach, describe, expect, it } from "vitest";
import { createSqlApplicationStore, createSqlMemberProfileStore } from "@website/db/sql";
import {
  PRIVACY_POLICY_VERSION,
  proofMark,
  proofSatisfied,
  type MemberProfile,
} from "@website/domain/members";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createProofActions } from "../../apps/admin/src/server/student-proofs";
import { createOwnProfile } from "../../apps/web/src/server/profile";
import { createOwnStudentProof } from "../../apps/web/src/server/student-proof";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMemberProfileStore>[0];
let clock = new Date("2026-11-10T05:00:00Z");
const profileInput = {
  fullName: "Siti Rahma",
  gender: "female",
  dateOfBirth: "2001-05-20",
  ppiCountry: "JP",
  university: "Kyoto University",
  educationLevel: "master",
  majors: ["Civil Engineering"],
  yearOfEntry: 2025,
  estimatedGraduationYear: 2027,
  addressAbroad: { line1: "1-2-3 Sakyo-ku", city: "Kyoto", countryCode: "JP" },
  addressIndonesia: { line1: "Jl. Merdeka No. 10", city: "Kota Bandung", province: "Jawa Barat" },
  whatsappNumber: "+6281234567890",
  emergencyContact: { phone: "+6281111111111" },
  timezone: "Asia/Tokyo",
  consent: { privacyPolicyVersion: PRIVACY_POLICY_VERSION, accepted: true },
};
const siti = { uid: "siti", email: "siti@example.org", emailVerified: true };
const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

let fake: ReturnType<typeof fakeDb>;
let files: Map<string, Uint8Array>;
let uuid = 0;
const profiles = () => createSqlMemberProfileStore(fake.db as unknown as Db);
const own = () =>
  createOwnStudentProof({
    profiles: profiles(),
    storage: {
      save: (path, bytes) => {
        files.set(path, bytes);
        return Promise.resolve();
      },
      remove: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
      read: (path) => Promise.resolve(files.get(path) ?? null),
    },
    now: () => clock,
    uuid: () => `${String((uuid += 1)).padStart(8, "0")}-0000-4000-8000-000000000000`,
  });
const upload = (owner: { uid: string } | null, bytes: Uint8Array, query: string) =>
  own().upload(
    owner,
    new Request(`https://web.test/api/account/student-proof${query}`, {
      method: "POST",
      body: bytes,
    }),
  );
const load = async () => (await profiles().findByUserId("siti")) as MemberProfile;
const saveProfile = (version: number | null, timezone = "Asia/Tokyo") =>
  createOwnProfile({
    profiles: profiles(),
    universities: { get: () => Promise.resolve(null) },
    now: () => clock,
  }).save(siti, { version, profile: { ...profileInput, timezone } });

beforeEach(async () => {
  clock = new Date("2026-11-10T05:00:00Z");
  fake = fakeDb();
  files = new Map();
  uuid = 0;
  fake.docs.set("users/siti", { uid: "siti", status: "active", version: 1 });
  const saved = await saveProfile(null);
  if (!saved.ok) throw new Error(JSON.stringify(saved));
});

describe("student status proof (11.3)", () => {
  it("a main file needs the confirmation; a supporting file needs a main file first", async () => {
    expect(await (await upload(siti, PDF, "?file=main")).json()).toEqual({
      ok: false,
      error: "confirm",
    });
    expect(await (await upload(siti, PNG, "?file=supporting")).json()).toEqual({
      ok: false,
      error: "main_first",
    });
    expect(files.size).toBe(0);
    expect((await upload(siti, PDF, "?file=main&confirmed=1")).status).toBe(201);
    expect((await upload(siti, PNG, "?file=supporting")).status).toBe(201);
    expect([...files.keys()].sort()).toEqual([
      "members/proofs/siti/main_00000002.pdf",
      "members/proofs/siti/supporting_00000003.png",
    ]);
    expect(await own().summary(siti)).toMatchObject({
      main: true,
      supporting: true,
      confirmedActive: true,
      review: null,
    });
  });

  it("replaces a file (the old one is deleted) and keeps the proof when the profile is saved", async () => {
    await upload(siti, PDF, "?file=main&confirmed=1");
    await upload(siti, PNG, "?file=main&confirmed=1");
    expect([...files.keys()]).toEqual(["members/proofs/siti/main_00000002.png"]);
    const before = await load();
    expect((await saveProfile(before.version, "Asia/Seoul")).ok).toBe(true);
    const after = await load();
    expect(after.timezone).toBe("Asia/Seoul");
    expect(after.studentProof?.main.path).toBe("members/proofs/siti/main_00000002.png");
    // the upload did not bump the version, so an open profile form is not made stale
    expect(before.version).toBe(1);
  });

  it("refuses wrong types, large files, a missing profile and signed-out people", async () => {
    const gif = new TextEncoder().encode("GIF89a");
    expect(await (await upload(siti, gif, "?file=main&confirmed=1")).json()).toEqual({
      ok: false,
      error: "not_file",
    });
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    expect((await upload(siti, big, "?file=main&confirmed=1")).status).toBe(413);
    expect(await (await upload(siti, PDF, "?file=other&confirmed=1")).json()).toEqual({
      ok: false,
      error: "invalid",
    });
    const nobody = { uid: "nobody" };
    expect(await (await upload(nobody, PDF, "?file=main&confirmed=1")).json()).toEqual({
      ok: false,
      error: "profile",
    });
    expect((await upload(null, PDF, "?file=main&confirmed=1")).status).toBe(401);
    expect(files.size).toBe(0);
  });

  it("is not asked from alumni; students and graduating students need a main file", async () => {
    const profile = await load();
    expect(proofSatisfied(profile, "2026-11-10")).toBe(false);
    expect(proofSatisfied(null, "2026-11-10")).toBe(false);
    const alumni = { ...profile, graduation: { on: "2026-01-01", markedBy: "siti" } };
    expect(proofSatisfied(alumni, "2026-11-10")).toBe(true);
    const graduating = { ...profile, graduation: { on: "2027-01-01", markedBy: "siti" } };
    expect(proofSatisfied(graduating, "2026-11-10")).toBe(false);
    await upload(siti, PDF, "?file=main&confirmed=1");
    expect(proofSatisfied(await load(), "2026-11-10")).toBe(true);
  });
});

describe("proof review by the committee (11.3)", () => {
  const staff = (permissions: string[]): Principal => ({
    kind: "user",
    userId: "committee-1",
    active: true,
    assignments: [
      {
        roleId: "r",
        scope: { type: "global" },
        permissions: new Set(normalizePermissions(permissions)),
      },
    ],
  });
  const context = () =>
    Promise.resolve({ actorEmail: "oprec@example.org", requestId: "req-123456", authTime: null });
  const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
  const told: Array<{ uid: string; state: string; at: number }> = [];
  const actions = () =>
    createProofActions({
      profiles: profiles(),
      applications: createSqlApplicationStore(fake.db as unknown as Db),
      signedUrl: (path) => Promise.resolve(`https://signed.test/private-files?t=${path}`),
      notify: (uid, review) => {
        told.push({ uid, state: review.state, at: review.at.getTime() });
        return Promise.resolve();
      },
      now: () => clock,
    });
  const reviewer = staff(["recruitment.review"]);
  const review = (state: string, note = "") =>
    actions().review(...as(reviewer))({ id: "r1_siti", state, note });

  beforeEach(() => {
    told.length = 0;
    fake.docs.set("applications/r1_siti", {
      userId: "siti",
      recruitmentId: "r1",
      status: "submitted",
      version: 1,
    });
  });

  it("marks OK or asks for a fix with a note; a new upload turns a fix into fixed; every request notifies", async () => {
    await upload(siti, PDF, "?file=main&confirmed=1");
    expect(proofMark(await load())).toBe("none");
    expect(await review("fix")).toMatchObject({ ok: false, error: "invalid_input" });

    expect(await review("fix", "Unreadable")).toEqual({ ok: true, data: { state: "fix" } });
    expect((await load()).proofReview).toMatchObject({
      state: "fix",
      note: "Unreadable",
      by: "committee-1",
    });

    clock = new Date("2026-11-11T05:00:00Z");
    await upload(siti, PNG, "?file=main&confirmed=1");
    expect(proofMark(await load())).toBe("fixed");

    clock = new Date("2026-11-12T05:00:00Z");
    await review("fix", "Still blurry");
    clock = new Date("2026-11-12T06:00:00Z");
    await review("ok");
    expect(told.map((t) => t.state)).toEqual(["fix", "fix", "ok"]);
    expect(new Set(told.map((t) => t.at)).size).toBe(3);
    expect(proofMark(await load())).toBe("ok");

    clock = new Date("2026-11-13T05:00:00Z");
    await upload(siti, PDF, "?file=main&confirmed=1");
    expect(proofMark(await load())).toBe("none");
  });

  it("refuses a review without a proof, without the permission or for a missing application", async () => {
    expect(await review("ok")).toMatchObject({ ok: false, error: "refused" });
    expect(
      await actions().review(...as(staff(["recruitment.offer"])))({
        id: "r1_siti",
        state: "ok",
        note: "",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await actions().review(...as(reviewer))({ id: "nope", state: "ok", note: "" }),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(told).toEqual([]);
  });
});
