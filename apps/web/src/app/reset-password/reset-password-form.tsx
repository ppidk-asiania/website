"use client";

import Link from "next/link";
import { useState } from "react";
import { resetPassword } from "@/lib/auth-client";
import { newPasswordSchema } from "@/lib/auth-errors";
import {
  Button,
  Field,
  formClass,
  formValues,
  Message,
  useAuthAction,
} from "@/components/auth-form";

export function ResetPasswordForm({ token }: { token: string }) {
  const { busy, error, run } = useAuthAction(null, "email");
  const [invalid, setInvalid] = useState("");
  if (!token) {
    return (
      <p className="auth-footer">
        This link is incomplete. <Link href="/forgot-password">Ask for a new one</Link>
      </p>
    );
  }
  return (
    <form
      className={formClass}
      onSubmit={(event) => {
        const parsed = newPasswordSchema.safeParse(formValues(event, "password", "confirm"));
        setInvalid(parsed.success ? "" : (parsed.error.issues[0]?.message ?? ""));
        if (parsed.success) void run(() => resetPassword(token, parsed.data.password));
      }}
    >
      <Field
        label="New password (at least 8 characters)"
        name="password"
        type="password"
        autoComplete="new-password"
      />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" />
      <Message text={invalid || error} />
      <Button busy={busy}>Save and sign in</Button>
      <p className="auth-footer">
        <Link href="/forgot-password">Ask for a new link</Link>
      </p>
    </form>
  );
}
