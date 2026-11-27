import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedProvider, OwnAccountAdmin, PasskeyCredential } from "@website/auth";
import {
  createSqlAccountEmailStore,
  createSqlMemberProfileStore,
  createSqlSignatureStore,
  createSqlUserStore,
  EMAIL_CODE_ATTEMPTS,
} from "@website/db/sql";
import { createMemoryPasskeyStore } from "@website/db/memory";
import { PRIVACY_POLICY_VERSION } from "@website/domain/members";
import {
  CLOSE_CONFIRMATION,
  createOwnAccount,
  EMAIL_CODE_TTL_MS,
} from "../../apps/web/src/server/own-account";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlUserStore>[0];
const now = new Date("2026-11-27T05:00:00Z");
const nowSeconds = now.getTime() / 1000;
const later = (ms: number) => new Date(now.getTime() + ms);
const google: LinkedProvider = {
  providerId: "google.com",
  email: "siti@gmail.com",
  name: "Siti Rahma",
  picture: "https://lh3.example/a.jpg",
};
const password: LinkedProvider = {
  providerId: "password",
  email: "siti@gmail.com",
  name: null,
  picture: null,
};
const siti = {
  uid: "siti",
  email: "siti@gmail.com",
  emailVerified: true,
  authTime: nowSeconds - 60,
};
const stale = { ...siti, authTime: nowSeconds - 60 * 60 };
const passkey = (id: string, at = now): PasskeyCredential => ({
  id,
  userId: "siti",
  publicKey: "pk",
  counter: 0,
  transports: [],
  createdAt: at,
  lastUsedAt: null,
  name: id,
  device: "Chrome · macOS",
});
const profileInput = {
  fullName: "Siti Rahma",
  gender: "female" as const,
  dateOfBirth: "2001-05-20",
  ppiCountry: "JP",
  university: "Kyoto University",
  educationLevel: "master" as const,
  majors: ["Civil Engineering"],
  yearOfEntry: 2025,
  estimatedGraduationYear: 2027,
  addressAbroad: { line1: "1-2-3 Sakyo-ku", city: "Kyoto", countryCode: "JP" },
  addressIndonesia: { line1: "Jl. Merdeka 10", city: "Kota Bandung", province: "Jawa Barat" },
  whatsappNumber: "+6281111111111",
  emergencyContact: { phone: "+6281222222222" },
  timezone: "Asia/Tokyo",
};

let fake: ReturnType<typeof fakeDb>;
let providers: LinkedProvider[];
let admin: OwnAccountAdmin & {
  changeEmail: ReturnType<typeof vi.fn>;
  unlinkProvider: ReturnType<typeof vi.fn>;
  deleteUser: ReturnType<typeof vi.fn>;
};
let passkeys: ReturnType<typeof createMemoryPasskeyStore>;
let send: ReturnType<typeof vi.fn<(message: unknown, key: string) => Promise<unknown>>>;
let removed: string[];
let codes: number[];

const db = () => fake.db as unknown as Db;
const emails = () => createSqlAccountEmailStore(db());
const users = () => createSqlUserStore(db());
const account = () =>
  createOwnAccount({
    admin,
    emails: emails(),
    passkeys,
    profiles: createSqlMemberProfileStore(db()),
    signatures: createSqlSignatureStore(db()),
    users: users(),
    storage: { remove: (path) => Promise.resolve(void removed.push(path)) },
    send,
    hash: (uid, code) => `${uid}-${code}`,
    randomInt: () => codes.shift() ?? 0,
    now: () => now,
  });
const sentCode = () =>
  /code: (\d{4})/.exec((send.mock.lastCall?.[0] as { text: string }).text)?.[1];

beforeEach(() => {
  fake = fakeDb();
  providers = [google];
  admin = {
    details: () => Promise.resolve({ providers, createdAt: new Date("2026-02-04T00:00:00Z") }),
    changeEmail: vi.fn(() => Promise.resolve()),
    unlinkProvider: vi.fn(() => Promise.resolve()),
    deleteUser: vi.fn(() => Promise.resolve()),
  };
  passkeys = createMemoryPasskeyStore();
  send = vi.fn(() => Promise.resolve("logged"));
  removed = [];
  codes = [42];
});

describe("account overview", () => {
  it("shows Google, both addresses and the passkeys, newest first", async () => {
    await passkeys.add(passkey("old", later(-86_400_000)));
    await passkeys.add(passkey("new"));
    await account().requestCode(siti, { kind: "backup", email: "Siti.Backup@Example.org" });
    const overview = await account().overview(siti);
    expect(overview).toMatchObject({
      google,
      createdAt: new Date("2026-02-04T00:00:00Z"),
      primary: { email: "siti@gmail.com", verified: true },
      backup: { email: "siti.backup@example.org", verified: false },
      pending: { kind: "backup", email: "siti.backup@example.org" },
    });
    expect(overview.passkeys.map((p) => p.id)).toEqual(["new", "old"]);
    expect(overview.passkeys[0]).not.toHaveProperty("publicKey");
  });

  it("has no Google, backup or pending code for a fresh password account", async () => {
    providers = [password];
    expect(await account().overview(siti)).toMatchObject({
      google: null,
      backup: null,
      pending: null,
      passkeys: [],
    });
  });
});

describe("e-mail codes", () => {
  it("sends a 4-digit code and proves a backup address with it", async () => {
    expect(await account().requestCode(siti, { kind: "backup", email: "b@example.org" })).toEqual({
      ok: true,
      email: "b@example.org",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", to: "b@example.org" }),
      `email-code:siti:${later(EMAIL_CODE_TTL_MS).getTime()}`,
    );
    expect(sentCode()).toBe("0042");
    expect(await account().confirmCode(siti, { code: "0042" })).toEqual({
      ok: true,
      kind: "backup",
    });
    expect(await emails().get("siti")).toMatchObject({
      backupEmail: "b@example.org",
      backupVerifiedAt: now,
      pending: null,
    });
    expect(await account().confirmCode(siti, { code: "0042" })).toEqual({
      ok: false,
      error: "none",
    });
    expect(admin.changeEmail).not.toHaveBeenCalled();
  });

  it("changes the sign-in e-mail only after the new address is proven", async () => {
    await account().requestCode(siti, { kind: "primary", email: "new@example.org" });
    expect(admin.changeEmail).not.toHaveBeenCalled();
    expect(await account().confirmCode(siti, { code: "0042" })).toEqual({
      ok: true,
      kind: "primary",
    });
    expect(admin.changeEmail).toHaveBeenCalledWith("siti", "new@example.org");
    expect((await emails().get("siti"))?.backupEmail).toBeNull();
  });

  it("lets an unverified sign-in address prove itself, but refuses re-proving a verified one", async () => {
    const unverified = { ...siti, emailVerified: false };
    expect(await account().requestCode(siti, { kind: "primary", email: "SITI@gmail.com" })).toEqual(
      {
        ok: false,
        error: "same",
      },
    );
    expect(await account().requestCode(siti, { kind: "backup", email: "siti@gmail.com" })).toEqual({
      ok: false,
      error: "same",
    });
    expect(
      await account().requestCode(unverified, { kind: "primary", email: "siti@gmail.com" }),
    ).toMatchObject({ ok: true });
  });

  it("counts wrong codes, stops after the limit and expires codes", async () => {
    await account().requestCode(siti, { kind: "backup", email: "b@example.org" });
    for (let i = 0; i < EMAIL_CODE_ATTEMPTS; i++) {
      expect(await account().confirmCode(siti, { code: "9999" })).toEqual({
        ok: false,
        error: "wrong",
      });
    }
    expect(await account().confirmCode(siti, { code: "0042" })).toEqual({
      ok: false,
      error: "none",
    });

    codes = [7];
    await account().requestCode(siti, { kind: "backup", email: "b@example.org" });
    const expired = createOwnAccount({
      ...({} as Parameters<typeof createOwnAccount>[0]),
      emails: emails(),
      hash: (uid, code) => `${uid}-${code}`,
      now: () => later(EMAIL_CODE_TTL_MS),
    } as Parameters<typeof createOwnAccount>[0]);
    expect(
      await expired.confirmCode({ ...siti, authTime: nowSeconds + 900 - 60 }, { code: "0007" }),
    ).toEqual({
      ok: false,
      error: "expired",
    });
    expect((await emails().get("siti"))?.pending).toBeNull();
  });

  it("reports an address already used by another account", async () => {
    admin.changeEmail.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "email_taken" }));
    await account().requestCode(siti, { kind: "primary", email: "taken@example.org" });
    expect(await account().confirmCode(siti, { code: "0042" })).toEqual({
      ok: false,
      error: "taken",
    });
    admin.changeEmail.mockRejectedValueOnce(new Error("network"));
    codes = [42];
    await account().requestCode(siti, { kind: "primary", email: "taken@example.org" });
    await expect(account().confirmCode(siti, { code: "0042" })).rejects.toThrow("network");
  });

  it("needs a recent sign-in and valid input", async () => {
    expect(await account().confirmCode(siti, { code: "0042" })).toEqual({
      ok: false,
      error: "none",
    });
    for (const run of [
      (o: typeof siti | null) =>
        account().requestCode(o, { kind: "backup", email: "b@example.org" }),
      (o: typeof siti | null) => account().confirmCode(o, { code: "0042" }),
    ]) {
      expect(await run(null)).toEqual({ ok: false, error: "signin" });
      expect(await run(stale)).toEqual({ ok: false, error: "reauthenticate" });
    }
    for (const input of [
      { kind: "backup", email: "not-an-email" },
      { kind: "other", email: "b@example.org" },
      { kind: "backup", email: "b@example.org", extra: 1 },
    ]) {
      expect(await account().requestCode(siti, input)).toEqual({ ok: false, error: "invalid" });
    }
    expect(await account().confirmCode(siti, { code: "12345" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("disconnecting Google", () => {
  it("unlinks Google when another way to sign in remains", async () => {
    await passkeys.add(passkey("key"));
    expect(await account().disconnectGoogle(siti)).toEqual({ ok: true });
    expect(admin.unlinkProvider).toHaveBeenCalledWith("siti", "google.com");
    providers = [google, password];
    await passkeys.remove("key", "siti");
    expect(await account().disconnectGoogle(siti)).toEqual({ ok: true });
  });

  it("refuses the last way in, an account without Google and a stale sign-in", async () => {
    expect(await account().disconnectGoogle(siti)).toEqual({ ok: false, error: "last_method" });
    providers = [password];
    expect(await account().disconnectGoogle(siti)).toEqual({ ok: false, error: "not_linked" });
    expect(await account().disconnectGoogle(stale)).toEqual({
      ok: false,
      error: "reauthenticate",
    });
    expect(await account().disconnectGoogle(null)).toEqual({ ok: false, error: "signin" });
    expect(admin.unlinkProvider).not.toHaveBeenCalled();
  });
});

describe("deleting the account", () => {
  const seed = async () => {
    await users().recordSignIn({ uid: "siti", email: "siti@gmail.com", name: "Siti" }, now);
    const profiles = createSqlMemberProfileStore(db());
    await profiles.save(
      {
        ...profileInput,
        id: "siti",
        userId: "siti",
        email: "siti@gmail.com",
        consent: { privacyPolicyVersion: PRIVACY_POLICY_VERSION, consentedAt: now },
        chapterId: null,
        graduation: { on: null, markedBy: null },
        whatsappVerifiedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      null,
    );
    await profiles.updateProof("siti", () => ({
      studentProof: {
        main: { path: "members/proofs/siti/main.png", type: "png" },
        supporting: { path: "members/proofs/siti/extra.pdf", type: "pdf" },
        confirmedActive: true,
        uploadedAt: now,
      },
      proofReview: null,
    }));
    await profiles.issueWhatsappCode("siti", "codehash", now);
    await createSqlSignatureStore(db()).replace(
      "siti",
      { path: "signatures/siti.bin", type: "png", widthMm: 40, rotation: 0 },
      now,
    );
    await passkeys.add(passkey("key"));
    await account().requestCode(siti, { kind: "backup", email: "b@example.org" });
  };

  it("removes personal data and the sign-in, keeping an anonymous users row", async () => {
    await seed();
    expect(await account().close(siti, { confirm: CLOSE_CONFIRMATION })).toEqual({ ok: true });
    expect(fake.docs.get("memberProfiles/siti")).toBeUndefined();
    expect([...fake.docs.keys()].some((k) => k.startsWith("whatsappLinkCodes/"))).toBe(false);
    expect(fake.docs.get("userSignatures/siti")).toBeUndefined();
    expect(fake.docs.get("accountEmails/siti")).toBeUndefined();
    expect(await passkeys.listByUser("siti")).toEqual([]);
    expect(removed.sort()).toEqual([
      "members/proofs/siti/extra.pdf",
      "members/proofs/siti/main.png",
      "signatures/siti.bin",
    ]);
    expect(fake.docs.get("users/siti")).toMatchObject({
      status: "inactive",
      email: null,
      name: null,
      roleIds: [],
    });
    expect(admin.deleteUser).toHaveBeenCalledWith("siti");
    const audit = [...fake.docs.entries()]
      .filter(([k]) => k.startsWith("auditLogs/"))
      .map(([, v]) => v);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "DELETE", resourceType: "user", resourceId: "siti" }),
        expect.objectContaining({ action: "DELETE", resourceType: "profile", before: null }),
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain("Siti Rahma");

    // a retry after a failure part-way finishes the job
    expect(await account().close(siti, { confirm: CLOSE_CONFIRMATION })).toEqual({ ok: true });
    expect(admin.deleteUser).toHaveBeenCalledTimes(2);
  });

  it("works for an account that never saved anything", async () => {
    expect(await account().close(siti, { confirm: CLOSE_CONFIRMATION })).toEqual({ ok: true });
    expect(removed).toEqual([]);
  });

  it("needs the typed confirmation, a recent sign-in and no staff or officer roles", async () => {
    await seed();
    for (const input of [{ confirm: "delete account" }, {}, null]) {
      expect(await account().close(siti, input)).toEqual({ ok: false, error: "confirm" });
    }
    expect(await account().close(stale, { confirm: CLOSE_CONFIRMATION })).toEqual({
      ok: false,
      error: "reauthenticate",
    });
    expect(await account().close(null, { confirm: CLOSE_CONFIRMATION })).toEqual({
      ok: false,
      error: "signin",
    });
    const row = fake.docs.get("users/siti") as Record<string, unknown>;
    fake.docs.set("users/siti", {
      ...row,
      roleAssignments: [
        { roleId: "visitor", scope: { type: "global" } },
        { roleId: "editor", scope: { type: "global" } },
      ],
    });
    expect(await account().close(siti, { confirm: CLOSE_CONFIRMATION })).toEqual({
      ok: false,
      error: "roles",
    });
    expect(fake.docs.get("memberProfiles/siti")).toBeDefined();
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });
});
