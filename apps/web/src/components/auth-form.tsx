"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { continueWithGoogle, renderGoogleButton, signInWithPasskey } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import {
  readSignInMethod,
  rememberSignInMethod,
  type SignInMethod,
} from "@/lib/remembered-account";
import { COUNTRIES } from "./ppi-slider";

export const formClass = "ui-form";

/** The page of every sign-in screen: logo, content and legal links, no site header or footer (globals.css). */
export function AuthCard(props: { title?: string; subtitle?: string; children: ReactNode }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setShown((i) => (i + 1) % COUNTRIES.length), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <main className="auth-page">
      {/* Phones only: the home page's country photos, fading from one to the next every 5 s. */}
      <div className="auth-art" aria-hidden="true">
        {COUNTRIES.map((country, i) => (
          <Image
            key={country.mapNo}
            className="auth-art__photo"
            data-shown={i === shown || undefined}
            src={`/home/${country.mapNo}.png`}
            alt=""
            width={800}
            height={600}
            sizes="100vw"
          />
        ))}
      </div>
      <div className="auth-card">
        <a href="/" className="auth-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- same static file as the site header logo */}
          <img src="/logo.webp" alt="PPIDK Asia-Oseania" width={3286} height={1024} />
        </a>
        {props.title && (
          <div className="auth-card__head">
            <h1>{props.title}</h1>
            <p>{props.subtitle}</p>
          </div>
        )}
        {props.children}
        <p className="auth-footer auth-legal">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
        </p>
      </div>
    </main>
  );
}

/** "Continue with email" button that reveals the email form in its place. */
export function EmailOption(props: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return props.children;
  return (
    <Button type="button" busy={false} onClick={() => setOpen(true)}>
      Continue with email
      <LastUsed method="email" />
    </Button>
  );
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

const noSubscribe = () => () => {};

/** "Last used" on the button this browser last signed in with; nothing on the server render. */
function LastUsed(props: { method: SignInMethod }) {
  const last = useSyncExternalStore(noSubscribe, readSignInMethod, () => null);
  return last === props.method ? <span className="auth-badge">Last used</span> : null;
}

/** `method` is remembered after a successful sign-in, for the "Last used" badge. */
export function useAuthAction(next: string | null = null, method?: SignInMethod) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go: Navigate = (path) => {
    // Full load: the header lives in the root layout and is hidden on auth pages, so a client
    // transition leaves it stale (no navigation) until the next refresh.
    window.location.assign(path);
  };
  async function run(
    action: () => Promise<void>,
    onSuccess: (go: Navigate) => void = () => go(next ?? "/settings/account"),
  ) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (method) rememberSignInMethod(method);
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

function FingerprintIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}

export function PasskeyButton(props: { next?: string | null }) {
  const { busy, error, run } = useAuthAction(props.next ?? null, "passkey");
  return (
    <>
      <Button type="button" outline busy={busy} onClick={() => void run(signInWithPasskey)}>
        <FingerprintIcon />
        Continue with passkey
        <LastUsed method="passkey" />
      </Button>
      <Message text={error} />
    </>
  );
}

/**
 * Google Identity Services only takes clicks on its own button (an iframe), so that button lies
 * invisibly over one drawn like the others; it hands back an ID token for the server.
 */
export function GoogleButton(props: { next?: string | null }) {
  const { busy, error, run } = useAuthAction(props.next ?? null, "google");
  const [unavailable, setUnavailable] = useState("");
  const slot = useRef<HTMLDivElement>(null);
  const onCredential = useEffectEvent((credential: string) => {
    void run(() => continueWithGoogle(credential));
  });
  useEffect(() => {
    if (!slot.current) return;
    renderGoogleButton(slot.current, (credential) => onCredential(credential)).catch((e: unknown) =>
      setUnavailable(authErrorMessage(e)),
    );
  }, []);
  return (
    <>
      <div className="auth-google" aria-busy={busy}>
        <span className="ui-button" data-variant="outline" aria-hidden="true">
          <GoogleLogo />
          Continue with Google
          <LastUsed method="google" />
        </span>
        <div ref={slot} className="auth-google__slot" />
      </div>
      <Message text={error || unavailable} />
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
