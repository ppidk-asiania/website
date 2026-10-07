import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { clientAuth } from "./firebase-client";

/** Browser-side sign-in flows. Every flow ends with our HttpOnly session cookie. */

async function postJson(
  url: string,
  body?: unknown,
  failCode = "request/failed",
): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!response.ok) throw Object.assign(new Error(failCode), { code: failCode });
  return response;
}

/** Exchanges the fresh Firebase sign-in for a session cookie, then forgets it in the browser. */
async function startSession(user: User): Promise<void> {
  try {
    await postJson("/api/session", { idToken: await user.getIdToken() });
  } finally {
    await firebaseSignOut(await clientAuth());
  }
}

/** Sign up or sign in with Google (the same action for both). */
export async function continueWithGoogle(): Promise<void> {
  const { user } = await signInWithPopup(await clientAuth(), new GoogleAuthProvider());
  await startSession(user);
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { user } = await createUserWithEmailAndPassword(await clientAuth(), email, password);
  await sendEmailVerification(user);
  await startSession(user);
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { user } = await signInWithEmailAndPassword(await clientAuth(), email, password);
  await startSession(user);
}

/** Firebase emails a reset link. Unknown emails are not reported (no account enumeration). */
export async function sendPasswordReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(await clientAuth(), email, {
      url: `${window.location.origin}/login`,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
  }
}

export async function signInWithPasskey(): Promise<void> {
  const options = (await (await postJson("/api/passkeys/login-options")).json()) as Parameters<
    typeof startAuthentication
  >[0]["optionsJSON"];
  const assertion = await startAuthentication({ optionsJSON: options });
  const verified = await postJson("/api/passkeys/login-verify", assertion, "passkey/failed");
  const { customToken } = (await verified.json()) as { customToken: string };
  const { user } = await signInWithCustomToken(await clientAuth(), customToken);
  await startSession(user);
}

/** Adds a passkey to the signed-in account (requires a sign-in in the last 15 minutes). */
export async function addPasskey(): Promise<void> {
  const options = (await (
    await postJson("/api/passkeys/register-options", undefined, "passkey/reauthenticate")
  ).json()) as Parameters<typeof startRegistration>[0]["optionsJSON"];
  const attestation = await startRegistration({ optionsJSON: options });
  await postJson("/api/passkeys/register-verify", attestation);
}

export async function signOut(): Promise<void> {
  await fetch("/api/session", { method: "DELETE" });
}
