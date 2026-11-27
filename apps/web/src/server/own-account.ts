import "server-only";
import { z } from "zod";
import {
  GOOGLE_PROVIDER as GOOGLE,
  isRecentSignIn,
  type LinkedProvider,
  type OwnAccountAdmin,
  type PasskeyStore,
  type VerifiedIdentity,
} from "@website/auth";
import type { AccountCloser } from "@website/db";
import type { EmailCodeKind, SqlAccountEmailStore } from "@website/db/sql";
import type { Message } from "@website/domain/messaging";

export const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
/** Typed by the person to switch the delete button on. */
export const CLOSE_CONFIRMATION = "DELETE ACCOUNT";

export type AccountOwner = Pick<VerifiedIdentity, "uid" | "email" | "emailVerified" | "authTime">;

export interface OwnAccountDeps {
  readonly admin: OwnAccountAdmin;
  readonly emails: Pick<SqlAccountEmailStore, "get" | "issueCode" | "checkCode" | "remove">;
  readonly passkeys: Pick<PasskeyStore, "listByUser" | "remove">;
  readonly profiles: { remove(uid: string, now: Date): Promise<string[]> };
  readonly signatures: { remove(uid: string): Promise<string | null> };
  readonly users: AccountCloser;
  readonly storage: { remove(path: string): Promise<void> };
  readonly send: (message: Message, key: string) => Promise<unknown>;
  readonly hash: (uid: string, code: string) => string;
  readonly randomInt: (max: number) => number;
  readonly now: () => Date;
}

export interface PasskeyRow {
  readonly id: string;
  readonly name: string;
  readonly device: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export interface AccountOverview {
  readonly google: LinkedProvider | null;
  readonly createdAt: Date | null;
  readonly primary: { readonly email: string | null; readonly verified: boolean };
  readonly backup: { readonly email: string; readonly verified: boolean } | null;
  readonly pending: { readonly kind: EmailCodeKind; readonly email: string } | null;
  readonly passkeys: readonly PasskeyRow[];
}

type Refusal = "signin" | "reauthenticate";
type Result<E extends string, T = object> = ({ ok: true } & T) | { ok: false; error: Refusal | E };

const CodeRequest = z
  .object({
    kind: z.enum(["primary", "backup"]),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  })
  .strict();
const CodeAnswer = z.object({ code: z.string().regex(/^\d{4}$/) }).strict();
const CloseInput = z.object({ confirm: z.string() }).strict();

export function createOwnAccount(deps: OwnAccountDeps) {
  /** Changing how one signs in or which addresses one owns needs a sign-in in the last 15 min. */
  const allowed = (owner: AccountOwner | null): AccountOwner | Refusal =>
    !owner
      ? "signin"
      : isRecentSignIn(owner, deps.now().getTime() / 1000)
        ? owner
        : "reauthenticate";

  return {
    async overview(owner: AccountOwner): Promise<AccountOverview> {
      const [details, emails, passkeys] = await Promise.all([
        deps.admin.details(owner.uid),
        deps.emails.get(owner.uid),
        deps.passkeys.listByUser(owner.uid),
      ]);
      return {
        google: details.providers.find((p) => p.providerId === GOOGLE) ?? null,
        createdAt: details.createdAt,
        primary: { email: owner.email, verified: owner.emailVerified },
        backup: emails?.backupEmail
          ? { email: emails.backupEmail, verified: emails.backupVerifiedAt !== null }
          : null,
        pending: emails?.pending ?? null,
        passkeys: passkeys
          .map(({ id, name, device, createdAt, lastUsedAt }) => ({
            id,
            name,
            device,
            createdAt,
            lastUsedAt,
          }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      };
    },

    /** Sends a 4-digit code to an address the person wants to prove (new primary, or backup). */
    async requestCode(
      owner: AccountOwner | null,
      input: unknown,
    ): Promise<Result<"invalid" | "same", { email: string }>> {
      const me = allowed(owner);
      if (typeof me === "string") return { ok: false, error: me };
      const parsed = CodeRequest.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { kind, email } = parsed.data;
      if (email === me.email?.toLowerCase() && (kind === "backup" || me.emailVerified)) {
        return { ok: false, error: "same" };
      }
      const code = String(deps.randomInt(10_000)).padStart(4, "0");
      const expiresAt = new Date(deps.now().getTime() + EMAIL_CODE_TTL_MS);
      await deps.emails.issueCode(me.uid, {
        kind,
        email,
        codeHash: deps.hash(me.uid, code),
        expiresAt,
      });
      const text = `Kode verifikasi e-mail PPIDK Asia-Oseania: ${code}\nBerlaku 15 menit.\n\nYour PPIDK Asia-Oseania e-mail verification code: ${code}\nIt is valid for 15 minutes. If you did not ask for it, ignore this e-mail.`;
      await deps.send(
        {
          channel: "email",
          to: email,
          subject: `Kode verifikasi / Verification code: ${code}`,
          text,
          // the text is fixed apart from the digits: nothing to escape
          html: `<p>${text.replace(/\n/g, "<br>")}</p>`,
        },
        `email-code:${me.uid}:${expiresAt.getTime()}`,
      );
      return { ok: true, email };
    },

    /** A right code proves the address: a backup is marked verified, a primary replaces the sign-in e-mail. */
    async confirmCode(
      owner: AccountOwner | null,
      input: unknown,
    ): Promise<
      Result<"invalid" | "wrong" | "expired" | "none" | "taken", { kind: EmailCodeKind }>
    > {
      const me = allowed(owner);
      if (typeof me === "string") return { ok: false, error: me };
      const parsed = CodeAnswer.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const checked = await deps.emails.checkCode(
        me.uid,
        deps.hash(me.uid, parsed.data.code),
        deps.now(),
      );
      if (!checked.ok) return { ok: false, error: checked.reason };
      if (checked.kind === "primary") {
        try {
          await deps.admin.changeEmail(me.uid, checked.email);
        } catch (error) {
          if ((error as { code?: string }).code === "email_taken") {
            return { ok: false, error: "taken" };
          }
          throw error;
        }
      }
      return { ok: true, kind: checked.kind };
    },

    async disconnectGoogle(
      owner: AccountOwner | null,
    ): Promise<Result<"not_linked" | "last_method">> {
      const me = allowed(owner);
      if (typeof me === "string") return { ok: false, error: me };
      const [details, passkeys] = await Promise.all([
        deps.admin.details(me.uid),
        deps.passkeys.listByUser(me.uid),
      ]);
      if (!details.providers.some((p) => p.providerId === GOOGLE)) {
        return { ok: false, error: "not_linked" };
      }
      const others =
        details.providers.filter((p) => p.providerId !== GOOGLE).length + passkeys.length;
      if (others === 0) return { ok: false, error: "last_method" };
      await deps.admin.unlinkProvider(me.uid, GOOGLE);
      return { ok: true };
    },

    /**
     * Deletes the account: personal data (profile, proof files, signature, passkeys, backup
     * address) and the sign-in account. Registrations, letters, certificates and audit entries
     * stay as records; the users row is kept without name or e-mail. Safe to retry.
     */
    async close(owner: AccountOwner | null, input: unknown): Promise<Result<"confirm" | "roles">> {
      const me = allowed(owner);
      if (typeof me === "string") return { ok: false, error: me };
      const parsed = CloseInput.safeParse(input);
      if (parsed.data?.confirm !== CLOSE_CONFIRMATION) return { ok: false, error: "confirm" };
      const now = deps.now();
      if ((await deps.users.closeAccount(me.uid, now)) === "roles") {
        return { ok: false, error: "roles" };
      }
      const [files, signature, passkeys] = await Promise.all([
        deps.profiles.remove(me.uid, now),
        deps.signatures.remove(me.uid),
        deps.passkeys.listByUser(me.uid),
      ]);
      await Promise.all([
        ...passkeys.map((p) => deps.passkeys.remove(p.id, me.uid)),
        ...[...files, ...(signature ? [signature] : [])].map((path) => deps.storage.remove(path)),
        deps.emails.remove(me.uid),
      ]);
      await deps.admin.deleteUser(me.uid);
      return { ok: true };
    },
  };
}
