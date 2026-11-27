import { createHash, randomUUID } from "node:crypto";
import type { Database, DocumentReference } from "./store";
import type { AuthAccount, AuthAccountStore, GoogleLink } from "@website/auth";
import { safeId } from "@website/security/validation";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function toAccount(uid: string, data: Record<string, unknown>): AuthAccount {
  return {
    uid,
    email: (data["email"] as string | null) ?? null,
    emailVerified: data["emailVerified"] === true,
    name: (data["name"] as string | null) ?? null,
    picture: (data["picture"] as string | null) ?? null,
    google: (data["google"] as GoogleLink | null) ?? null,
    passwordHash: (data["passwordHash"] as string | null) ?? null,
    disabled: data["disabled"] === true,
    sessionsValidAfter: data["sessionsValidAfter"] as number,
    createdAt: (data["createdAt"] as { toDate(): Date }).toDate(),
  };
}

/**
 * Sign-in accounts (`authAccounts/{uid}`). `authLogins/{email-<sha256> | google-<sha256>}` holds
 * the uid of each e-mail address and Google account, so both stay unique across accounts.
 */
export function createSqlAuthAccountStore(db: Database): AuthAccountStore {
  const accounts = db.collection("authAccounts");
  const logins = db.collection("authLogins");
  const emailRef = (email: string) => logins.doc(`email-${hash(email.toLowerCase())}`);
  const googleRef = (sub: string) => logins.doc(`google-${hash(sub)}`);
  const keysOf = (email: string | null, google: GoogleLink | null): DocumentReference[] => [
    ...(email ? [emailRef(email)] : []),
    ...(google ? [googleRef(google.sub)] : []),
  ];

  async function byLogin(ref: DocumentReference): Promise<AuthAccount | null> {
    const login = await ref.get();
    const uid = login.exists ? (login.get("uid") as string) : null;
    if (!uid) return null;
    const account = await accounts.doc(uid).get();
    return account.exists ? toAccount(uid, account.data() as Record<string, unknown>) : null;
  }

  return {
    async get(uid) {
      const doc = await accounts.doc(safeId.parse(uid)).get();
      return doc.exists ? toAccount(uid, doc.data() as Record<string, unknown>) : null;
    },

    findByEmail: (email) => byLogin(emailRef(email)),
    findByGoogleSub: (sub) => byLogin(googleRef(sub)),

    create({ uid: chosen, ...fields }, now) {
      const uid = safeId.parse(chosen ?? randomUUID());
      const keys = keysOf(fields.email, fields.google);
      return db.runTransaction(async (tx) => {
        const [existing, ...taken] = await Promise.all([
          tx.get(accounts.doc(uid)),
          ...keys.map((ref) => tx.get(ref)),
        ]);
        if (existing?.exists || taken.some((login) => login.exists)) return null;
        const data = { ...fields, createdAt: now };
        tx.set(accounts.doc(uid), data);
        for (const ref of keys) tx.set(ref, { uid });
        return toAccount(uid, { ...data, createdAt: { toDate: () => now } });
      });
    },

    update(uid, change) {
      const ref = accounts.doc(safeId.parse(uid));
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return false;
        const before = toAccount(uid, doc.data() as Record<string, unknown>);
        const after = { ...before, ...change };
        const oldKeys = keysOf(before.email, before.google);
        const newKeys = keysOf(after.email, after.google);
        const missing = (from: DocumentReference[]) => (r: DocumentReference) =>
          !from.some((o) => o.path === r.path);
        const added = newKeys.filter(missing(oldKeys));
        const taken = await Promise.all(added.map((r) => tx.get(r)));
        if (taken.some((login) => login.exists && login.get("uid") !== uid)) return false;
        for (const r of oldKeys.filter(missing(newKeys))) tx.delete(r);
        for (const r of added) tx.set(r, { uid });
        tx.update(ref, change);
        return true;
      });
    },

    async delete(uid) {
      const ref = accounts.doc(safeId.parse(uid));
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return;
        const account = toAccount(uid, doc.data() as Record<string, unknown>);
        for (const key of keysOf(account.email, account.google)) tx.delete(key);
        tx.delete(ref);
      });
    },
  };
}
