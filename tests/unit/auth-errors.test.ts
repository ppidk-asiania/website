import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  newPasswordSchema,
  signUpSchema,
} from "../../apps/web/src/lib/auth-errors";

describe("sign-in error messages (no account enumeration, no internal details)", () => {
  it("gives one message for unknown email and wrong password (the server answers 401 to both)", () => {
    expect(authErrorMessage({ code: "wrong-credentials" })).toBe("Email or password is incorrect.");
  });

  it("explains actionable cases and hides everything else", () => {
    expect(authErrorMessage({ code: "too-many-requests" })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ code: "email-in-use" })).toMatch(/sign in or reset/);
    expect(authErrorMessage({ code: "network" })).toMatch(/connection/);
    expect(authErrorMessage({ code: "google/failed" })).toMatch(/Google sign-in didn't work/);
    expect(authErrorMessage({ code: "reset/expired" })).toMatch(/Ask for a new one/);
    expect(authErrorMessage({ name: "NotAllowedError" })).toBe("");
    expect(authErrorMessage({ code: "passkey/failed" })).toMatch(/Passkey sign-in didn't work/);
    expect(authErrorMessage({ code: "passkey/reauthenticate" })).toMatch(/sign in again/);
    expect(authErrorMessage(new Error("internal: projects/123 quota"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(authErrorMessage("x")).toBe("Something went wrong. Please try again.");
  });
});

describe("sign-up form validation", () => {
  it("requires a valid email, 8+ character password and matching confirmation", () => {
    const ok = { email: "a@b.org", password: "longenough1", confirm: "longenough1" };
    expect(signUpSchema.safeParse(ok).success).toBe(true);
    expect(signUpSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...ok, password: "short", confirm: "short" }).success).toBe(
      false,
    );
    expect(signUpSchema.safeParse({ ...ok, confirm: "different1" }).success).toBe(false);
  });

  it("checks a new password (reset) the same way", () => {
    expect(
      newPasswordSchema.safeParse({ password: "longenough1", confirm: "longenough1" }).success,
    ).toBe(true);
    expect(newPasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(
      false,
    );
    expect(newPasswordSchema.safeParse({ password: "longenough1", confirm: "x" }).success).toBe(
      false,
    );
  });
});
