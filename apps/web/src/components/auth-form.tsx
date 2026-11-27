"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { continueWithGoogle } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export const formClass = "ui-form";

/** The page of every sign-in screen: one centred card, no site header or footer (globals.css). */
export function AuthCard(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <h1>{props.title}</h1>
          <p>{props.subtitle}</p>
        </div>
        {props.children}
      </div>
      <Link href="/" className="auth-home">
        ← Back to home
      </Link>
    </main>
  );
}

export function AuthSeparator() {
  return <p className="auth-separator">Or</p>;
}

export function Field(props: {
  label: string;
  name: string;
  type: "email" | "password";
  autoComplete: string;
  aside?: ReactNode;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = props.type === "password";
  return (
    <div className="ui-field">
      <div className="auth-field__head">
        <label htmlFor={id}>{props.label}</label>
        {props.aside}
      </div>
      <div className="auth-field__control">
        <input
          id={id}
          className="ui-input"
          name={props.name}
          type={isPassword && shown ? "text" : props.type}
          autoComplete={props.autoComplete}
          required
        />
        {isPassword && (
          <button
            type="button"
            className="auth-field__toggle"
            aria-controls={id}
            onClick={() => setShown(!shown)}
          >
            {shown ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Message(props: { text: string; tone?: "error" | "info" }) {
  if (!props.text) return null;
  return (
    <p
      role={props.tone === "info" ? "status" : "alert"}
      className="ui-message"
      data-tone={props.tone ?? "error"}
    >
      {props.text}
    </p>
  );
}

export function Button(props: {
  children: ReactNode;
  busy: boolean;
  type?: "submit" | "button";
  outline?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={props.type ?? "submit"}
      disabled={props.busy}
      onClick={props.onClick}
      className="ui-button"
      data-variant={props.outline ? "outline" : undefined}
    >
      {props.children}
    </button>
  );
}

type Navigate = (path: string) => void;

export function useAuthAction(next: string | null = null) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go: Navigate = (path) => {
    if (!path.startsWith("/")) {
      window.location.assign(path);
      return;
    }
    router.push(path);
    router.refresh();
  };
  async function run(
    action: () => Promise<void>,
    onSuccess: (go: Navigate) => void = () => go(next ?? "/settings/account"),
  ) {
    setBusy(true);
    setError("");
    try {
      await action();
      onSuccess(go);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function GoogleLogo() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
      <path
        fill="var(--color-google-blue)"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="var(--color-google-green)"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="var(--color-google-yellow)"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="var(--color-google-red)"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function GoogleButton(props: { next?: string | null }) {
  const { busy, error, run } = useAuthAction(props.next ?? null);
  return (
    <>
      <Button type="button" outline busy={busy} onClick={() => void run(continueWithGoogle)}>
        <GoogleLogo />
        Continue with Google
      </Button>
      <Message text={error} />
    </>
  );
}

export function formValues(
  event: FormEvent<HTMLFormElement>,
  ...names: string[]
): Record<string, string> {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return Object.fromEntries(
    names.map((name) => {
      const value = data.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}
