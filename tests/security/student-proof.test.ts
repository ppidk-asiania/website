import { beforeEach, describe, expect, it } from "vitest";
import { createSqlApplicationStore, createSqlMemberProfileStore } from "@website/db/sql";
import { PRIVACY_POLICY_VERSION } from "@website/domain/members";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createProofActions } from "../../apps/admin/src/server/student-proofs";
import { createOwnProfile } from "../../apps/web/src/server/profile";
import { createOwnStudentProof } from "../../apps/web/src/server/student-proof";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMemberProfileStore>[0];
const now = new Date("2026-11-10T05:00:00Z");
const later = new Date("2026-11-11T05:00:00Z");
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
const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF");
const siti = { uid: "siti", email: "siti@example.org", emailVerified: true };
const rina = { uid: "rina", email: "rina@example.org", emailVerified: true };

let fake: ReturnType<typeof fakeDb>;
let files: Map<string, Uint8Array>;
const profiles = () => createSqlMemberProfileStore(fake.db as unknown as Db);
const own = (at = now, id = "abcdef12") =>
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
    now: () => at,
    uuid: () => `${id}-0000-4000-8000-000000000000`,
  });
const post = (owner: typeof siti | null, query: string, at = now, id = "abcdef12") =>
  own(at, id).upload(
    owner,
    new Request(`https://web.test/api/account/student-proof${query}`, {
      method: "POST",
      body: PDF,
    }),
  );
const saveProfile = (user: typeof siti) =>
  createOwnProfile({
    profiles: profiles(),
    universities: { get: () => Promise.resolve(null) },
    now: () => now,
  }).save(user, { version: null, profile: profileInput });
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
const as = (principal: Principal) =>
  [
    () => Promise.resolve(principal),
    () => Promise.resolve({ actorEmail: "a@example.org", requestId: "req-123456", authTime: null }),
  ] as const;
const admin = () =>
  createProofActions({
    profiles: profiles(),
    applications: createSqlApplicationStore(fake.db as unknown as Db),
    signedUrl: (path) => Promise.resolve(`https://web.test/private-files?t=${path}`),
    notify: () => Promise.resolve(),
    now: () => now,
  });
const reviewer = staff(["recruitment.review"]);
const link = (principal: Principal, id: string, file = "main") =>
  admin().fileUrl(...as(principal))({ id, file });

beforeEach(async () => {
  fake = fakeDb();
  files = new Map();
  for (const user of [siti, rina]) {
    fake.docs.set(`users/${user.uid}`, { uid: user.uid, status: "active", version: 1 });
    await saveProfile(user);
    fake.docs.set(`applications/r1_${user.uid}`, {
      userId: user.uid,
      recruitmentId: "r1",
      status: "submitted",
      version: 1,
    });
  }
  await post(siti, "?file=main&confirmed=1");
});

describe("student proof access", () => {
  it("another account's proof is never shown: the owner route reads only the session's own file", async () => {
    const mine = await own().view(siti, "main");
    expect(mine.status).toBe(200);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PDF);
    expect((await own().view(rina, "main")).status).toBe(404);
    expect((await own().view(rina, "../siti")).status).toBe(404);
    expect((await own().view(siti, "supporting")).status).toBe(404);
    expect((await own().view(null, "main")).status).toBe(401);
  });

  it("every proof response of ours is private, no-store and not sniffable", async () => {
    const responses = [
      await own().view(siti, "main"),
      await own().view(rina, "main"),
      await post(siti, "?file=main"),
    ];
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(responses[0]?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(responses[0]?.headers.get("content-type")).toBe("application/pdf");
  });

  it("the committee's link is made only for the applicant's own file, needs recruitment.review and carries a version", async () => {
    expect(await link(reviewer, "r1_siti")).toEqual({
      ok: true,
      data: {
        url: `https://web.test/private-files?t=members/proofs/siti/main_abcdef12.pdf&v=${now.getTime()}`,
      },
    });
    // rina has no proof: refused, never a fall back to another applicant's file
    expect(await link(reviewer, "r1_rina")).toMatchObject({ ok: false, error: "refused" });
    expect(await link(reviewer, "r1_siti", "supporting")).toMatchObject({
      ok: false,
      error: "refused",
    });
    expect(await link(reviewer, "r1_siti", "../rina")).toMatchObject({
      ok: false,
      error: "invalid_input",
    });
    expect(await link(staff(["recruitment.offer"]), "r1_siti")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await link(staff([]), "r1_siti")).toEqual({ ok: false, error: "forbidden" });
  });

  it("a replaced file gets a new address and a new version, so a cached copy is never shown", async () => {
    const before = await link(reviewer, "r1_siti");
    await post(siti, "?file=main&confirmed=1", later, "99999999");
    const after = JSON.stringify(await link(reviewer, "r1_siti"));
    expect(after).not.toEqual(JSON.stringify(before));
    expect(after).toContain(`v=${later.getTime()}`);
    expect(after).toContain("main_99999999.pdf");
  });
});
