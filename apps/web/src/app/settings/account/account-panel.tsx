"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { FieldIcon } from "@/components/site-field-icon";
import type { Dictionary } from "@/i18n/dictionaries";
import { addPasskey, deletePasskey, renamePasskey, signOut } from "@/lib/auth-client";
import type { AccountOverview, PasskeyRow } from "@/server/own-account";
import {
  closeAccountAction,
  confirmEmailCodeAction,
  disconnectGoogleAction,
  requestEmailCodeAction,
} from "./actions";

type Text = Dictionary["settingsAccount"];
type ErrorKey = keyof Text["errors"];
type Dialog =
  | { kind: "add" }
  | { kind: "rename"; passkey: PasskeyRow }
  | { kind: "deletePasskey"; passkey: PasskeyRow }
  | { kind: "email"; email: "primary" | "backup" }
  | { kind: "code"; email: string; emailKind: "primary" | "backup" }
  | { kind: "disconnect" }
  | { kind: "close" };

const CLOSE_WORDS = "DELETE ACCOUNT";
const NAME_MAX = 32;
const SIGN_IN_AGAIN = `/login?next=${encodeURIComponent("/settings/account")}`;

/** "12 Mar 2026" in the reader's language. */
const day = (date: Date, language: string) =>
  new Intl.DateTimeFormat(language, { day: "2-digit", month: "short", year: "numeric" }).format(
    date,
  );

const noSubscription = () => () => {};

/** Absolute on the server, "2 hours ago" in the browser (no hydration mismatch). */
function Ago(props: { date: Date | null; language: string; never: string }) {
  const now = useSyncExternalStore(
    noSubscription,
    () => Date.now(),
    () => null,
  );
  if (!props.date) return <>{props.never}</>;
  if (now === null) return <>{day(props.date, props.language)}</>;
  const seconds = (props.date.getTime() - now) / 1000;
  const steps = [
    [60, 1, "second"],
    [3600, 60, "minute"],
    [86_400, 3600, "hour"],
    [2_592_000, 86_400, "day"],
    [31_536_000, 2_592_000, "month"],
    [Infinity, 31_536_000, "year"],
  ] as const;
  const [, size, unit] = steps.find(([limit]) => Math.abs(seconds) < limit) ?? steps[5];
  return (
    <>
      {new Intl.RelativeTimeFormat(props.language, { numeric: "auto" }).format(
        Math.round(seconds / size),
        unit,
      )}
    </>
  );
}

function Modal(props: {
  title: string;
  intro?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="site-settings-dialog"
      aria-labelledby="settings-dialog-title"
      onClose={props.onClose}
    >
      <h2 id="settings-dialog-title">{props.title}</h2>
      {props.intro && <p className="site-settings-dialog__intro">{props.intro}</p>}
      {props.children}
    </dialog>
  );
}

export function AccountPanel(props: {
  t: Text;
  language: string;
  overview: AccountOverview;
  deviceGuess: string;
  methodsNote: string;
}) {
  const { t, overview, language } = props;
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [text, setText] = useState("");
  const [digits, setDigits] = useState(["", "", "", ""]);
  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);

  const open = (next: Dialog, initial = "") => {
    setError(null);
    setText(initial);
    setDigits(["", "", "", ""]);
    setDialog(next);
  };
  const close = () => setDialog(null);
  const errorOf = (e: unknown): ErrorKey => {
    const code = (e as { code?: unknown }).code;
    if (code === "passkey/reauthenticate") return "reauthenticate";
    return typeof code === "string" && code in t.errors ? (code as ErrorKey) : "failed";
  };
  /** Runs an action; `false` keeps the dialog open with the error shown. */
  const run = async (action: () => Promise<boolean | void>) => {
    setBusy(true);
    setError(null);
    try {
      if ((await action()) !== false) {
        close();
        router.refresh();
      }
    } catch (e) {
      // the person closed the browser's passkey prompt: nothing to report
      if ((e as { name?: string }).name !== "NotAllowedError") setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };
  const refused = (result: { ok: true } | { ok: false; error: string }) => {
    if (result.ok) return true;
    setError(result.error in t.errors ? (result.error as ErrorKey) : "failed");
    return false;
  };

  const sendCode = (kind: "primary" | "backup", email: string) =>
    run(async () => {
      const result = await requestEmailCodeAction({ kind, email });
      if (!refused(result)) return false;
      open({ kind: "code", email, emailKind: kind });
      return false;
    });

  const message = error && (
    <p role="alert" className="ui-message">
      {t.errors[error]} {error === "reauthenticate" && <a href={SIGN_IN_AGAIN}>{t.signInAgain}</a>}
    </p>
  );
  const actions = (submit: ReactNode) => (
    <div className="site-settings-dialog__actions">
      <button type="button" className="site-settings-button" onClick={close}>
        <FieldIcon name="back" className="site-settings-icon" />
        {t.back}
      </button>
      {submit}
    </div>
  );
  const saveButton = (disabled = false) => (
    <button type="submit" className="site-settings-button" disabled={busy || disabled}>
      <FieldIcon name="save" className="site-settings-icon" />
      {t.save}
    </button>
  );
  const nameField = (
    <label className="ui-field site-settings-dialog__field">
      <span className="site-settings-label">{t.passkeyName}</span>
      <span className="site-settings-count-input">
        <input
          className="ui-input"
          value={text}
          maxLength={NAME_MAX}
          required
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
        <span aria-hidden="true">
          {text.length}/{NAME_MAX}
        </span>
      </span>
    </label>
  );
  const status = (verified: boolean) => (
    <span className="site-settings-status" data-ok={verified}>
      {verified ? t.verified : t.notVerified}
    </span>
  );
  const editButton = (onClick: () => void, label = t.edit) => (
    <button type="button" className="site-settings-button" data-tone="dark" onClick={onClick}>
      <FieldIcon name="pen" className="site-settings-icon" />
      {label}
    </button>
  );

  return (
    <>
      <section aria-labelledby="connected-title">
        <h2 id="connected-title" className="site-settings-section-title">
          {t.connected}
        </h2>
        <p className="site-settings-hint">{t.connectedHint}</p>
        <ul className="site-settings-cards">
          {overview.google && (
            <li className="site-settings-card">
              {overview.google.picture ? (
                // eslint-disable-next-line @next/next/no-img-element -- Google's own avatar URL
                <img
                  className="site-settings-card__avatar"
                  src={overview.google.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="site-settings-card__icon" aria-hidden="true">
                  G
                </span>
              )}
              <div className="site-settings-card__text">
                <strong>Google{overview.google.name ? ` · ${overview.google.name}` : ""}</strong>
                <span>
                  {[
                    overview.google.email,
                    overview.createdAt && `${t.since} ${day(overview.createdAt, language)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <span className="site-settings-status" data-ok="true">
                {t.connectedLabel}
              </span>
              <button
                type="button"
                className="site-settings-button"
                data-tone="dark"
                onClick={() => open({ kind: "disconnect" })}
              >
                {t.disconnectGoogle}
              </button>
            </li>
          )}
          <li className="site-settings-card">
            <span className="site-settings-card__icon" aria-hidden="true">
              <FieldIcon name="mail" className="site-settings-icon" />
            </span>
            <div className="site-settings-card__text">
              <strong>{overview.primary.email}</strong>
              <span>{t.primary}</span>
            </div>
            {status(overview.primary.verified)}
            {!overview.primary.verified && overview.primary.email && (
              <button
                type="button"
                className="site-settings-button"
                data-tone="dark"
                disabled={busy}
                onClick={() => void sendCode("primary", overview.primary.email as string)}
              >
                {t.resend}
              </button>
            )}
            {editButton(() => open({ kind: "email", email: "primary" }))}
          </li>
          <li className="site-settings-card">
            <span className="site-settings-card__icon" aria-hidden="true">
              <FieldIcon name="shield" className="site-settings-icon" />
            </span>
            <div className="site-settings-card__text">
              <strong>{overview.backup?.email ?? t.noBackup}</strong>
              <span>{t.backup}</span>
            </div>
            {overview.backup && status(overview.backup.verified)}
            {overview.backup && !overview.backup.verified && (
              <button
                type="button"
                className="site-settings-button"
                data-tone="dark"
                disabled={busy}
                onClick={() => void sendCode("backup", overview.backup?.email as string)}
              >
                {t.resend}
              </button>
            )}
            {editButton(
              () => open({ kind: "email", email: "backup" }, overview.backup?.email ?? ""),
              overview.backup ? t.edit : t.add,
            )}
          </li>
        </ul>
        {!dialog && message}
      </section>

      <hr className="site-settings-rule" />

      <section aria-labelledby="passkeys-title">
        <div className="site-settings-section-head">
          <div>
            <h2 id="passkeys-title" className="site-settings-section-title">
              {t.passkeys} <span className="site-settings-badge">{overview.passkeys.length}</span>
            </h2>
            <p className="site-settings-hint">{t.passkeysHint}</p>
          </div>
          <button
            type="button"
            className="site-settings-button"
            onClick={() => open({ kind: "add" }, props.deviceGuess)}
          >
            <FieldIcon name="plus" className="site-settings-icon" />
            {t.addPasskey}
          </button>
        </div>
        {overview.passkeys.length === 0 ? (
          <p className="site-settings-hint">{t.noPasskeys}</p>
        ) : (
          <ul className="site-settings-cards">
            {overview.passkeys.map((passkey) => (
              <li key={passkey.id} className="site-settings-card">
                <span className="site-settings-card__icon" aria-hidden="true">
                  <FieldIcon name="key" className="site-settings-icon" />
                </span>
                <div className="site-settings-card__text">
                  <strong>{passkey.name || passkey.device || t.unnamed}</strong>
                  <span>
                    {[passkey.device, `${t.createdOn} ${day(passkey.createdAt, language)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <span className="site-settings-used">
                  <small>{t.lastUsed}</small>
                  <Ago date={passkey.lastUsedAt} language={language} never={t.never} />
                </span>
                <button
                  type="button"
                  className="site-settings-button"
                  data-tone="danger"
                  onClick={() => open({ kind: "deletePasskey", passkey })}
                >
                  <FieldIcon name="trash" className="site-settings-icon" />
                  {t.delete}
                </button>
                {editButton(() => open({ kind: "rename", passkey }, passkey.name))}
              </li>
            ))}
          </ul>
        )}
        <p className="site-settings-hint">{props.methodsNote}</p>
      </section>

      <hr className="site-settings-rule" />

      <section className="site-settings-danger" aria-labelledby="danger-title">
        <h2 id="danger-title">{t.danger}</h2>
        <div className="site-settings-danger__row">
          <div>
            <strong>{t.deleteAccount}</strong>
            <p>{t.deleteHint}</p>
          </div>
          <button
            type="button"
            className="site-settings-button"
            data-tone="danger"
            onClick={() => open({ kind: "close" })}
          >
            <FieldIcon name="trash" className="site-settings-icon" />
            {t.deleteAccount}
          </button>
        </div>
      </section>

      {(dialog?.kind === "add" || dialog?.kind === "rename") && (
        <Modal
          title={dialog.kind === "add" ? t.addTitle : t.editTitle}
          intro={dialog.kind === "add" ? t.addIntro : t.editIntro}
          onClose={close}
        >
          <form
            className="site-settings-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = text.trim();
              void run(() =>
                dialog.kind === "add" ? addPasskey(name) : renamePasskey(dialog.passkey.id, name),
              );
            }}
          >
            <div className="site-settings-device">
              <FieldIcon name="monitor" className="site-settings-icon" />
              <div>
                <strong>
                  {dialog.kind === "add"
                    ? props.deviceGuess || t.thisDevice
                    : dialog.passkey.device || t.unnamed}
                </strong>
                <span>
                  {dialog.kind === "add"
                    ? t.deviceHint
                    : `${t.createdOn} ${day(dialog.passkey.createdAt, language)}`}
                </span>
              </div>
            </div>
            {nameField}
            {message}
            {actions(saveButton(text.trim().length === 0))}
          </form>
        </Modal>
      )}

      {dialog?.kind === "deletePasskey" && (
        <Modal title={t.deletePasskeyTitle} intro={t.deletePasskeyIntro} onClose={close}>
          <p className="site-settings-device">
            <FieldIcon name="key" className="site-settings-icon" />
            <strong>{dialog.passkey.name || dialog.passkey.device || t.unnamed}</strong>
          </p>
          {message}
          {actions(
            <button
              type="button"
              className="site-settings-button"
              data-tone="danger"
              disabled={busy}
              onClick={() => void run(() => deletePasskey(dialog.passkey.id))}
            >
              <FieldIcon name="trash" className="site-settings-icon" />
              {t.delete}
            </button>,
          )}
        </Modal>
      )}

      {dialog?.kind === "email" && (
        <Modal
          title={dialog.email === "primary" ? t.changePrimary : t.changeBackup}
          intro={t.emailFormIntro}
          onClose={close}
        >
          <form
            className="site-settings-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode(dialog.email, text.trim());
            }}
          >
            <label className="ui-field site-settings-dialog__field">
              <span className="site-settings-label">{t.newEmail}</span>
              <input
                className="ui-input"
                type="email"
                value={text}
                required
                autoFocus
                autoComplete="email"
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            {message}
            {actions(
              <button type="submit" className="site-settings-button" disabled={busy}>
                {t.sendCode}
              </button>,
            )}
          </form>
        </Modal>
      )}

      {dialog?.kind === "code" && (
        <Modal
          title={t.emailTitle}
          intro={
            <>
              {t.emailIntro} {dialog.email}
            </>
          }
          onClose={close}
        >
          <form
            className="site-settings-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await confirmEmailCodeAction({ code: digits.join("") });
                if (!refused(result)) return false;
                if (result.ok && result.kind === "primary") {
                  // the sign-in e-mail changed and every session was ended: sign in again
                  await signOut();
                  router.push(SIGN_IN_AGAIN);
                  return false;
                }
                return true;
              });
            }}
          >
            <p className="site-settings-hint">
              {t.noCode}{" "}
              <button
                type="button"
                className="site-settings-link"
                disabled={busy}
                onClick={() => void sendCode(dialog.emailKind, dialog.email)}
              >
                {t.resendCode}
              </button>
            </p>
            <div className="site-settings-code">
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    digitRefs.current[i] = el;
                  }}
                  className="site-settings-code__digit"
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  aria-label={`${t.digit} ${i + 1}`}
                  maxLength={1}
                  value={digit}
                  autoFocus={i === 0}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digit && i > 0) digitRefs.current[i - 1]?.focus();
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
                    if (pasted.length !== 4) return;
                    e.preventDefault();
                    setDigits(pasted.split(""));
                    digitRefs.current[3]?.focus();
                  }}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, "").slice(-1);
                    setDigits((all) => all.map((d, j) => (j === i ? value : d)));
                    if (value && i < 3) digitRefs.current[i + 1]?.focus();
                  }}
                />
              ))}
            </div>
            {message}
            {actions(
              <button
                type="submit"
                className="site-settings-button"
                disabled={busy || digits.some((d) => !d)}
              >
                {t.verifyEmail}
              </button>,
            )}
          </form>
        </Modal>
      )}

      {dialog?.kind === "disconnect" && (
        <Modal title={t.disconnectTitle} intro={t.disconnectIntro} onClose={close}>
          {message}
          {actions(
            <button
              type="button"
              className="site-settings-button"
              data-tone="danger"
              disabled={busy}
              onClick={() => void run(async () => refused(await disconnectGoogleAction()))}
            >
              {t.disconnect}
            </button>,
          )}
        </Modal>
      )}

      {dialog?.kind === "close" && (
        <Modal title={t.deleteTitle} intro={t.deleteIntro} onClose={close}>
          <form
            className="site-settings-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (!refused(await closeAccountAction({ confirm: text }))) return false;
                await signOut();
                router.push("/");
                router.refresh();
                return false;
              });
            }}
          >
            <p className="site-settings-warning" role="note">
              <FieldIcon name="alert" className="site-settings-icon" />
              {t.deleteWarn.replace("{count}", String(overview.passkeys.length))}
            </p>
            <label className="ui-field site-settings-dialog__field">
              <span className="site-settings-label">{t.confirmLabel}</span>
              <input
                className="ui-input"
                value={text}
                autoComplete="off"
                autoFocus
                onChange={(e) => setText(e.target.value)}
              />
              <small className="site-settings-hint">{t.confirmHint}</small>
            </label>
            {message}
            {actions(
              <button
                type="submit"
                className="site-settings-button"
                data-tone="danger"
                disabled={busy || text !== CLOSE_WORDS}
              >
                <FieldIcon name="trash" className="site-settings-icon" />
                {t.deleteForever}
              </button>,
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
