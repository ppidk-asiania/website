#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseTsv } from "../../packages/db/src/ppidk/people.ts";
import {
  mapPpidkRecruitment,
  PPIDK_RECRUITMENT_TABLES,
} from "../../packages/db/src/ppidk/recruitment.ts";
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
    "Usage: import-ppidk-recruitment.mjs --dir <folder with the .tsv files> [--files <PPIDK private storage>] [--apply]",
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

const tables = Object.fromEntries(
  PPIDK_RECRUITMENT_TABLES.map((name) => [
    name,
    parseTsv(readFileSync(join(values.dir, `${name}.tsv`), "utf8")),
  ]),
);

const periods = await db.collection("periods").get();
if (!periods.docs.some((doc) => doc.id.startsWith("ppidk-"))) {
  console.error("Run the people import first (import-ppidk-people.mjs).");
  process.exit(1);
}

const existing = new Map();
const emails = tables.users.map((u) => u.email?.trim().toLowerCase()).filter(Boolean);
for (const email of new Set(emails)) {
  const account = await accounts.findByEmail(email);
  if (account) existing.set(email, account.uid);
}
const emailOf = new Map(tables.users.map((u) => [u.id, u.email?.trim().toLowerCase()]));
const uidOf = (ppidkId) => existing.get(emailOf.get(ppidkId)) ?? `ppidk-${ppidkId}`;

const localPath = (ppidkPath) => {
  if (!values.files) return null;
  const root = resolve(values.files);
  const full = resolve(root, ppidkPath);
  const inside = relative(root, full);
  return inside && !inside.startsWith("..") ? full : null;
};
const fileSize = (ppidkPath) => {
  const full = localPath(ppidkPath);
  if (!full || !existsSync(full) || !statSync(full).isFile()) return null;
  const head = Buffer.alloc(5);
  const fd = openSync(full, "r");
  readSync(fd, head, 0, 5, 0);
  closeSync(fd);
  return head.toString("latin1") === "%PDF-" ? statSync(full).size : null;
};

const plan = mapPpidkRecruitment(tables, { uidOf, fileSize, now: new Date() });
const report = {
  dryRun: !values.apply,
  counts: plan.counts,
  skipped: plan.skipped,
};
writeFileSync(
  join(values.dir, "import-recruitment-report.json"),
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
  for (const file of plan.files) {
    await storage.save(file.to, readFileSync(localPath(file.from)), {
      visibility: "private",
      contentType: file.contentType,
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
