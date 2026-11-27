import { randomUUID } from "node:crypto";
import { safeId } from "@website/security/validation";
import { createSqlAccountEmailStore } from "./account-emails";
import { createSqlAuditWriter } from "./audit";
import { getDocumentsByIds } from "./batch";
import { createSqlMemberProfileStore } from "./member-profiles";
import { createSqlPasskeyStore } from "./passkeys";
import { createSqlSignatureStore } from "./signatures";
import type { Database } from "./store";

// Self-contained (no ../users import): infrastructure/scripts/remove-old-accounts.mjs loads it with
// plain Node type stripping, which cannot load @website/permissions.

export interface OldAccount {
  readonly uid: string;
  readonly email: string | null;
  readonly roleIds: readonly string[];
}

/**
 * Users rows left from the former Firebase user pool (DEC-24 fresh start): no sign-in account,
 * not a PPIDK import (re-running the import gives those an account), not closed yet.
 */
export async function listOldAccounts(db: Database): Promise<OldAccount[]> {
  const users = (await db.collection("users").get()).docs.filter(
    (doc) => !doc.id.startsWith("ppidk-") && !doc.get("closedAt"),
  );
  const accounts = await getDocumentsByIds(
    db,
    "authAccounts",
    users.map((doc) => doc.id),
  );
  return users
    .filter((doc) => !accounts.get(doc.id))
    .map((doc) => ({
      uid: doc.id,
      email: (doc.get("email") as string | null | undefined) ?? null,
      roleIds: (doc.get("roleIds") as string[] | undefined) ?? [],
    }));
}

/**
 * What deleting one's own account removes (web settings), plus the roles: personal data,
 * passkeys and backup address go, the users row stays without name, e-mail or roles. Safe to retry.
 */
export async function removeOldAccount(
  db: Database,
  storage: { remove(path: string): Promise<void> },
  uid: string,
  now: Date,
): Promise<void> {
  const passkeys = createSqlPasskeyStore(db);
  const [files, signature, keys] = await Promise.all([
    createSqlMemberProfileStore(db).remove(uid, now),
    createSqlSignatureStore(db).remove(uid),
    passkeys.listByUser(uid),
  ]);
  await Promise.all([
    ...keys.map((key) => passkeys.remove(key.id, uid)),
    ...[...files, ...(signature ? [signature] : [])].map((path) => storage.remove(path)),
    createSqlAccountEmailStore(db).remove(uid),
  ]);
  const ref = db.collection("users").doc(safeId.parse(uid));
  const audit = createSqlAuditWriter(db);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.get("closedAt")) return;
    const version = (snapshot.get("version") as number | undefined) ?? 0;
    const log = await audit.begin(tx);
    tx.update(ref, {
      status: "inactive",
      email: null,
      name: null,
      roleAssignments: [],
      roleIds: [],
      closedAt: now,
      version: version + 1,
    });
    log.append({
      id: randomUUID(),
      occurredAt: now,
      actor: { type: "system", id: "remove-old-accounts" },
      action: "DELETE",
      module: "users",
      title: uid,
      resourceType: "user",
      resourceId: uid,
      operationId: randomUUID(),
      before: {
        status: snapshot.get("status") as string,
        roleIds: snapshot.get("roleIds") as string[],
      },
      after: null,
      versionBefore: version,
      versionAfter: version + 1,
      revertible: false,
      revertOf: null,
      request: { requestId: randomUUID() },
      prevHash: null,
      hash: null,
    });
  });
}
