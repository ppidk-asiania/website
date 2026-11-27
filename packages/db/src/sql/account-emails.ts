import type { Database } from "./store";
import { safeId } from "@website/security/validation";
import { toDate } from "./slugged";

export type EmailCodeKind = "primary" | "backup";

export interface AccountEmails {
  readonly backupEmail: string | null;
  readonly backupVerifiedAt: Date | null;
  /** The address waiting for its code, if any. */
  readonly pending: { readonly kind: EmailCodeKind; readonly email: string } | null;
}

export type EmailCodeCheck =
  | { readonly ok: true; readonly kind: EmailCodeKind; readonly email: string }
  | { readonly ok: false; readonly reason: "none" | "wrong" | "expired" };

/** Wrong codes allowed before the code stops working (a new one must be sent). */
export const EMAIL_CODE_ATTEMPTS = 5;

/** `accountEmails/{uid}`: the backup address and the one code waiting to prove an address. */
export function createSqlAccountEmailStore(db: Database) {
  const ref = (uid: string) => db.collection("accountEmails").doc(safeId.parse(uid));
  return {
    async get(uid: string): Promise<AccountEmails | null> {
      const snapshot = await ref(uid).get();
      if (!snapshot.exists) return null;
      const pending = snapshot.get("pending") as { kind: EmailCodeKind; email: string } | null;
      return {
        backupEmail: snapshot.get("backupEmail") as string | null,
        backupVerifiedAt: toDate(snapshot.get("backupVerifiedAt")),
        pending: pending ? { kind: pending.kind, email: pending.email } : null,
      };
    },

    /** A new code replaces the old one; a backup address is saved (unproven) right away. */
    issueCode(
      uid: string,
      code: { kind: EmailCodeKind; email: string; codeHash: string; expiresAt: Date },
    ): Promise<void> {
      return db.runTransaction(async (tx) => {
        const current = await tx.get(ref(uid));
        const backup =
          code.kind === "backup" ? { backupEmail: code.email, backupVerifiedAt: null } : {};
        const pending = { ...code, attempts: 0 };
        if (current.exists) tx.update(ref(uid), { ...backup, pending });
        else tx.set(ref(uid), { backupEmail: null, backupVerifiedAt: null, ...backup, pending });
      });
    },

    /** Uses up an attempt; the right code is single use and proves a backup address at once. */
    checkCode(uid: string, codeHash: string, now: Date): Promise<EmailCodeCheck> {
      return db.runTransaction(async (tx) => {
        const current = await tx.get(ref(uid));
        const pending = current.exists
          ? (current.get("pending") as {
              kind: EmailCodeKind;
              email: string;
              codeHash: string;
              expiresAt: unknown;
              attempts: number;
            } | null)
          : null;
        if (!pending || pending.attempts >= EMAIL_CODE_ATTEMPTS) {
          return { ok: false, reason: "none" } as const;
        }
        if ((toDate(pending.expiresAt) as Date) <= now) {
          tx.update(ref(uid), { pending: null });
          return { ok: false, reason: "expired" } as const;
        }
        if (pending.codeHash !== codeHash) {
          tx.update(ref(uid), { pending: { ...pending, attempts: pending.attempts + 1 } });
          return { ok: false, reason: "wrong" } as const;
        }
        tx.update(ref(uid), {
          pending: null,
          ...(pending.kind === "backup" ? { backupVerifiedAt: now } : {}),
        });
        return { ok: true, kind: pending.kind, email: pending.email } as const;
      });
    },

    remove(uid: string): Promise<void> {
      return db.runTransaction((tx) => {
        tx.delete(ref(uid));
        return Promise.resolve();
      });
    },
  };
}

export type SqlAccountEmailStore = ReturnType<typeof createSqlAccountEmailStore>;
