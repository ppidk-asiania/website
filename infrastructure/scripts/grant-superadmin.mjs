#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string", multiple: true },
    apply: { type: "boolean", default: false },
  },
});
if (!values.email?.length) {
  console.error("Usage: grant-superadmin.mjs --email <address> [--email <address>] [--apply]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("Missing environment variables: DATABASE_URL");
  process.exit(2);
}

// The store's own imports leave out ".ts"; this lets plain `node` load them.
await import("./ts-register.mjs");
const { getDatabase } = await import("../../packages/db/src/sql/store.ts");
const { createSqlAuditWriter } = await import("../../packages/db/src/sql/audit.ts");
const db = getDatabase({ url: process.env.DATABASE_URL });
const users = db.collection("users");
const audit = createSqlAuditWriter(db);

// Same rule as isActiveSuperadmin in packages/db/src/users.ts.
const holdsSuperadmin = (assignments) =>
  assignments.some(
    (a) => a.roleId === "superadmin" && a.scope?.type === "global" && !a.revokedAt && !a.periodId,
  );
const snapshot = (status, assignments) => ({
  status,
  roleAssignments: assignments.map((a) => ({
    roleId: a.roleId,
    scope: a.scope,
    periodId: a.periodId ?? null,
    source: a.source ?? "manual",
    revokedAt: a.revokedAt?.toDate().toISOString() ?? null,
    appointmentId: a.appointmentId ?? null,
  })),
});

async function grant(email) {
  const found = await users.where("email", "==", email.trim().toLowerCase()).limit(1).get();
  const doc = found.docs[0];
  if (!doc) return { uid: "-", result: "no-record" };
  const ref = users.doc(doc.id);
  const result = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const assignments = current.roleAssignments ?? [];
    if (current.status !== "active") return "inactive";
    if (holdsSuperadmin(assignments)) return "already";
    if (!values.apply) return "would-grant";
    const added = {
      roleId: "superadmin",
      scope: { type: "global" },
      periodId: null,
      source: "manual",
      revokedAt: null,
      appointmentId: null,
    };
    const next = [...assignments, added];
    const version = current.version ?? 0;
    const now = new Date();
    const log = await audit.begin(tx);
    tx.update(ref, {
      roleAssignments: next,
      roleIds: [...new Set(next.map((a) => a.roleId))],
      version: version + 1,
    });
    log.append({
      id: randomUUID(),
      occurredAt: now,
      actor: { type: "system", id: "grant-superadmin" },
      action: "UPDATE",
      module: "users",
      title: current.email ?? doc.id,
      resourceType: "user",
      resourceId: doc.id,
      operationId: randomUUID(),
      before: snapshot(current.status, assignments),
      after: snapshot(current.status, next),
      versionBefore: version,
      versionAfter: version + 1,
      revertible: false,
      revertOf: null,
      request: { requestId: randomUUID() },
      prevHash: null,
      hash: null,
    });
    return "granted";
  });
  return { uid: doc.id, result };
}

const messages = {
  "no-record": "No account with this e-mail yet: sign in on the web app once, then run this again.",
  inactive: "The account is inactive: reactivate it first. Nothing changed.",
  already: "Already a superadmin. Nothing changed.",
  "would-grant": "Dry run: would add superadmin (global). Re-run with --apply.",
  granted:
    "Granted superadmin (global), recorded in the audit log. Sign out and in again to use admin.",
};
let failed = false;
for (const email of values.email) {
  const { uid, result } = await grant(email);
  console.log(`${email.trim().toLowerCase()} (${uid}): ${messages[result]}`);
  if (result === "no-record" || result === "inactive") failed = true;
}
await db.close();
process.exit(failed ? 1 : 0);
