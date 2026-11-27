import { describe, expect, it } from "vitest";
import {
  createSqlAuthAccountStore,
  createSqlPasskeyStore,
  listOldAccounts,
  removeOldAccount,
} from "@website/db/sql";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof listOldAccounts>[0];

const NOW = new Date("2026-11-28T10:00:00Z");
const user = (email: string, roleIds: string[]) => ({
  email,
  name: email.split("@")[0],
  status: "active",
  version: 3,
  roleAssignments: roleIds.map((roleId) => ({ roleId, scope: { type: "global" } })),
  roleIds,
});

async function setup() {
  const fake = fakeDb();
  const db = fake.db as unknown as Db;
  fake.docs.set("users/old1", user("old@example.org", ["visitor", "editor"]));
  fake.docs.set("users/kept", user("kept@example.org", ["visitor"]));
  fake.docs.set("users/ppidk-5", user("ppidk@example.org", ["visitor"]));
  fake.docs.set("users/gone", { ...user("x@example.org", []), closedAt: NOW });
  await createSqlAuthAccountStore(db).create(
    {
      uid: "kept",
      email: "kept@example.org",
      emailVerified: true,
      name: null,
      picture: null,
      google: null,
      passwordHash: null,
      disabled: false,
      sessionsValidAfter: 0,
    },
    NOW,
  );
  fake.docs.set("userSignatures/old1", { path: "signatures/old1.bin" });
  fake.docs.set("accountEmails/old1", { backupEmail: "b@example.org" });
  await createSqlPasskeyStore(db).add({
    id: "cred",
    userId: "old1",
    publicKey: "k",
    counter: 0,
    transports: [],
    createdAt: NOW,
    lastUsedAt: null,
    name: "",
    device: "",
  });
  return { fake, db };
}

describe("accounts of the former Firebase user pool (DEC-24 fresh start)", () => {
  it("lists users rows without a sign-in account, leaving PPIDK imports and closed rows out", async () => {
    const { db } = await setup();
    const old = await listOldAccounts(db);
    expect(old).toEqual([
      { uid: "old1", email: "old@example.org", roleIds: ["visitor", "editor"] },
    ]);
  });

  it("removes personal data, passkeys and roles, keeping an anonymous, audited users row", async () => {
    const { fake, db } = await setup();
    const removed: string[] = [];
    const storage = { remove: (path: string) => Promise.resolve(void removed.push(path)) };
    await removeOldAccount(db, storage, "old1", NOW);
    expect(fake.docs.get("users/old1")).toMatchObject({
      status: "inactive",
      email: null,
      name: null,
      roleIds: [],
      roleAssignments: [],
      version: 4,
    });
    for (const path of ["userSignatures/old1", "accountEmails/old1"]) {
      expect(fake.docs.get(path), path).toBeUndefined();
    }
    expect(removed).toEqual(["signatures/old1.bin"]);
    expect(await createSqlPasskeyStore(db).listByUser("old1")).toEqual([]);
    const audit = [...fake.docs.entries()].find(([path]) => path.startsWith("auditLogs/"));
    expect(audit?.[1]).toMatchObject({
      actor: { type: "system", id: "remove-old-accounts" },
      action: "DELETE",
      resourceId: "old1",
    });
    expect(await listOldAccounts(db)).toEqual([]);
    await removeOldAccount(db, storage, "old1", NOW);
    expect(fake.docs.get("users/old1")).toMatchObject({ version: 4 });
  });
});
