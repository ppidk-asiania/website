"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { continueWithGoogle } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

/** Small building blocks shared by the sign-in, sign-up and reset forms. */

export const formStyle = { display: "grid", gap: "0.75rem", maxWidth: 360 } as const;
const buttonStyle = { padding: "0.6rem 1rem", cursor: "pointer" } as const;

export function Field(props: {
  label: string;
  name: string;
  type: "email" | "password";
  autoComplete: string;
}) {
  return (
    <label style={{ display: "grid", gap: "0.25rem" }}>
      {props.label}
      <input name={props.name} type={props.type} autoComplete={props.autoComplete} required />
    </label>
  );
}

export function Message(props: { text: string; tone?: "error" | "info" }) {
  if (!props.text) return null;
  return (
    <p
      role={props.tone === "info" ? "status" : "alert"}
      style={{ color: props.tone === "info" ? "#166534" : "#b91c1c" }}
    >
      {props.text}
    </p>
  );
}

export function Button(props: {
  children: ReactNode;
  busy: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={props.type ?? "submit"}
      disabled={props.busy}
      onClick={props.onClick}
      style={buttonStyle}
    >
      {props.children}
    </button>
  );
}

type Navigate = (path: string) => void;

/** Runs an auth action with busy/error state; on success goes to the account page by default. */
export function useAuthAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go: Navigate = (path) => {
    router.push(path);
    router.refresh(); // re-render server components with the new session cookie
  };
  async function run(
    action: () => Promise<void>,
    onSuccess: (go: Navigate) => void = () => go("/account"),
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

export function GoogleButton() {
  const { busy, error, run } = useAuthAction();
  return (
    <>
      <Button type="button" busy={busy} onClick={() => void run(continueWithGoogle)}>
        Continue with Google
      </Button>
      <Message text={error} />
    </>
  );
}

/** Reads named string fields from a submitted form. */
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
