#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseTsv } from "../../packages/db/src/ppidk/people.ts";
import { mapPpidkPrograms, PPIDK_PROGRAM_TABLES } from "../../packages/db/src/ppidk/programs.ts";
import { createSqlAuthAccountStore } from "../../packages/db/src/sql/auth-accounts.ts";
import { getDatabase } from "../../packages/db/src/sql/store.ts";
import { createDbFileStorage } from "../../packages/db/src/sql/storage.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    files: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
if (!values.dir) {
  console.error(
    "Usage: import-ppidk-programs.mjs --dir <folder with the .tsv files> [--files <PPIDK PDFs>] [--apply]",
  );
  process.exit(2);
}
const required = ["DATABASE_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

const db = getDatabase({ url: process.env.DATABASE_URL });
const accounts = createSqlAuthAccountStore(db);

const read = (name) => parseTsv(readFileSync(join(values.dir, `${name}.tsv`), "utf8"));
const tables = Object.fromEntries(PPIDK_PROGRAM_TABLES.map((name) => [name, read(name)]));
const users = read("users");

const periods = await db.collection("periods").get();
if (!periods.docs.some((doc) => doc.id.startsWith("ppidk-"))) {
  console.error("Run the people import first (import-ppidk-people.mjs).");
  process.exit(1);
}

const existing = new Map();
const emails = users.map((u) => u.email?.trim().toLowerCase()).filter(Boolean);
for (const email of new Set(emails)) {
  const account = await accounts.findByEmail(email);
  if (account) existing.set(email, account.uid);
}
const emailOf = new Map(users.map((u) => [u.id, u.email?.trim().toLowerCase()]));
const uidOf = (ppidkId) => existing.get(emailOf.get(ppidkId)) ?? `ppidk-${ppidkId}`;

const localPath = (ppidkPath) => {
  if (!values.files) return null;
  const root = resolve(values.files);
  const full = resolve(root, ppidkPath);
  const inside = relative(root, full);
  return inside && !inside.startsWith("..") ? full : null;
};
const file = (ppidkPath) => {
  const full = localPath(ppidkPath);
  if (!full || !existsSync(full) || !statSync(full).isFile()) return null;
  const bytes = readFileSync(full);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
};

const plan = mapPpidkPrograms(tables, { uidOf, file, now: new Date() });

const report = { dryRun: !values.apply, counts: plan.counts, skipped: plan.skipped };
writeFileSync(
  join(values.dir, "import-programs-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({ ...report, skipped: plan.skipped.length }, null, 2));
if (!values.apply) {
  console.log("Dry run: nothing written. Add --apply to write.");
  process.exit(0);
}

if (plan.files.length > 0) {
  const storage = createDbFileStorage({
    db,
    baseUrl: "",
    secret: undefined,
  });
  for (const f of plan.files) {
    await storage.save(f.to, readFileSync(localPath(f.from)), {
      visibility: "private",
      contentType: f.contentType,
    });
  }
}

for (let i = 0; i < plan.writes.length; i += 400) {
  const batch = db.batch();
  for (const write of plan.writes.slice(i, i + 400)) batch.set(db.doc(write.path), write.data);
  await batch.commit();
}
console.log(`Done: ${plan.writes.length} documents written, ${plan.files.length} files copied.`);
await db.close();
