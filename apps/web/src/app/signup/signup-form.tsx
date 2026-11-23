"use client";

import Link from "next/link";
import { useState } from "react";
import { signUpWithEmail } from "@/lib/auth-client";
import { signUpSchema } from "@/lib/auth-errors";
import {
  AuthSeparator,
  Button,
  Field,
  formClass,
  formValues,
  GoogleButton,
  Message,
  useAuthAction,
} from "@/components/auth-form";

export function SignUpForm() {
  const { busy, error, run } = useAuthAction();
  const [invalid, setInvalid] = useState("");
  return (
    <>
      <form
        className={formClass}
        onSubmit={(event) => {
          const parsed = signUpSchema.safeParse(formValues(event, "email", "password", "confirm"));
          setInvalid(parsed.success ? "" : (parsed.error.issues[0]?.message ?? ""));
          if (parsed.success)
            void run(() => signUpWithEmail(parsed.data.email, parsed.data.password));
        }}
      >
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password (at least 8 characters)"
          name="password"
          type="password"
          autoComplete="new-password"
        />
        <Field
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
        />
        <Message text={invalid || error} />
        <Button busy={busy}>Create account</Button>
      </form>
      <AuthSeparator />
      <div className={formClass}>
        <GoogleButton />
      </div>
      <p className="auth-footer">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
