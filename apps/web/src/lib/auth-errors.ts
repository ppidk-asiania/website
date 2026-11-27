import { z } from "zod";

const MESSAGES = new Map<string, string>(
  Object.entries({
    "wrong-credentials": "Email or password is incorrect.",
    "too-many-requests": "Too many attempts. Wait a few minutes or reset your password.",
    "email-in-use":
      "Could not create the account. If you already have one, sign in or reset your password.",
    network: "Check your internet connection and try again.",
    "google/failed": "Google sign-in didn't work. Try again or use another sign-in method.",
    "reset/expired": "This link has expired or was already used. Ask for a new one.",
    NotAllowedError: "",
    "passkey/failed": "Passkey sign-in didn't work. Try again or use another sign-in method.",
    "passkey/reauthenticate": "For your security, sign in again before adding a passkey.",
  }),
);

export function authErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    for (const key of [code, name]) {
      const message = typeof key === "string" ? MESSAGES.get(key) : undefined;
      if (message !== undefined) return message;
    }
  }
  return "Something went wrong. Please try again.";
}

const newPassword = z.string().min(8, "Use a password with at least 8 characters.").max(128);

export const signUpSchema = z
  .object({
    email: z.email("Enter a valid email address."),
    password: newPassword,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match.",
  });

export const newPasswordSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match.",
  });
