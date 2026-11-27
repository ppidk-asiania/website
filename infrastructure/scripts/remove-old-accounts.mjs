#!/usr/bin/env node
// Removes what is left of the former Firebase user pool (DEC-24 fresh start): users rows with no
// sign-in account. Dry run lists them; --apply removes their personal data, passkeys and roles
// and keeps an anonymous users row (as deleting one's own account does). Audited, safe to retry.
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
if (!process.env.DATABASE_URL) {
  console.error("Missing environment variables: DATABASE_URL");
  process.exit(2);
}

// The store's own imports leave out ".ts"; this lets plain `node` load them.
await import("./ts-register.mjs");
const { getDatabase } = await import("../../packages/db/src/sql/store.ts");
const { createDbFileStorage } = await import("../../packages/db/src/sql/storage.ts");
const { listOldAccounts, removeOldAccount } =
  await import("../../packages/db/src/sql/old-accounts.ts");
const db = getDatabase({ url: process.env.DATABASE_URL });
const storage = createDbFileStorage({ db, baseUrl: "", secret: "" });

const old = await listOldAccounts(db);
for (const user of old) {
  console.log(`${user.uid}  ${user.email ?? "-"}  ${user.roleIds.join(", ") || "-"}`);
}
console.log(`${old.length} account(s) from the former Firebase user pool.`);
if (!values.apply) {
  console.log("Dry run: nothing changed. Re-run with --apply to remove them.");
} else {
  for (const user of old) await removeOldAccount(db, storage, user.uid, new Date());
  console.log(`Removed ${old.length}; each is recorded in the audit log.`);
}
await db.close();
