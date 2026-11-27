import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

const coded = (code: string) => Object.assign(new Error(code), { code });

/** Fails with `codes[status]`, "too-many-requests" (429), "network" or "request/failed". */
async function postJson(
  url: string,
  body?: unknown,
  codes: Partial<Record<number, string>> = {},
): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  }).catch(() => {
    throw coded("network");
  });
  if (response.ok) return response;
  throw coded(
    codes[response.status] ?? (response.status === 429 ? "too-many-requests" : "request/failed"),
  );
}

const startSession = (body: Record<string, string>, codes: Partial<Record<number, string>>) =>
  postJson("/api/session", body, codes).then(() => undefined);

type GoogleId = {
  initialize(options: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    ux_mode: "popup";
    context: "signin" | "signup";
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
};

let googleScript: Promise<GoogleId> | undefined;

function loadGoogle(): Promise<GoogleId> {
  googleScript ??= new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const google = (window as Window & { google?: { accounts: { id: GoogleId } } }).google;
      if (google) resolve(google.accounts.id);
      else reject(coded("network"));
    };
    script.onerror = () => {
      googleScript = undefined;
      reject(coded("network"));
    };
    document.head.append(script);
  });
  return googleScript;
}

/** Draws Google's "Continue with Google" button (Google Identity Services) into `parent`. */
export async function renderGoogleButton(
  parent: HTMLElement,
  onCredential: (credential: string) => void,
): Promise<void> {
  const clientId = process.env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"];
  if (!clientId) throw coded("google/failed");
  const google = await loadGoogle();
  google.initialize({
    client_id: clientId,
    callback: ({ credential }) => onCredential(credential),
    ux_mode: "popup",
    context: "signin",
  });
  google.renderButton(parent, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    logo_alignment: "center",
    width: Math.min(400, Math.max(200, parent.clientWidth)),
  });
}

export function continueWithGoogle(credential: string): Promise<void> {
  return startSession({ method: "google", credential }, { 401: "google/failed" });
}

export function signUpWithEmail(email: string, password: string): Promise<void> {
  return startSession({ method: "signup", email, password }, { 409: "email-in-use" });
}

export function signInWithEmail(email: string, password: string): Promise<void> {
  return startSession({ method: "password", email, password }, { 401: "wrong-credentials" });
}

export async function sendPasswordReset(email: string): Promise<void> {
  await postJson("/api/session", { method: "reset-request", email });
}

export function resetPassword(token: string, password: string): Promise<void> {
  return startSession({ method: "reset", token, password }, { 401: "reset/expired" });
}

export async function signInWithPasskey(): Promise<void> {
  const options = (await (await postJson("/api/passkeys/login-options")).json()) as Parameters<
    typeof startAuthentication
  >[0]["optionsJSON"];
  const assertion = await startAuthentication({ optionsJSON: options });
  await postJson("/api/passkeys/login-verify", assertion, { 401: "passkey/failed" });
}

export async function addPasskey(name?: string): Promise<void> {
  const options = (await (
    await postJson("/api/passkeys/register-options", undefined, { 401: "passkey/reauthenticate" })
  ).json()) as Parameters<typeof startRegistration>[0]["optionsJSON"];
  const attestation = await startRegistration({ optionsJSON: options });
  await postJson("/api/passkeys/register-verify", { ...attestation, ...(name ? { name } : {}) });
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  await postJson("/api/passkeys/rename", { id, name });
}

/** 401: sign in again first; 409: it is the account's last way to sign in. */
export async function deletePasskey(id: string): Promise<void> {
  await postJson("/api/passkeys/delete", { id }, { 401: "reauthenticate", 409: "last_passkey" });
}

export async function signOut(): Promise<void> {
  await fetch("/api/session", { method: "DELETE" });
}
