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

/** Google's own button (Google Identity Services); it hands back an ID token for the server. */
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
        <div ref={slot} />
        <LastUsed method="google" />
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
