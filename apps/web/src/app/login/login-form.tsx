"use client";

import Link from "next/link";
import { signInWithEmail } from "@/lib/auth-client";
import {
  Button,
  EmailOption,
  Field,
  formClass,
  formValues,
  GoogleButton,
  Message,
  PasskeyButton,
  useAuthAction,
} from "@/components/auth-form";

export function LoginForm({ next }: { next: string | null }) {
  const email = useAuthAction(next, "email");
  return (
    <>
      <div className={formClass}>
        <PasskeyButton next={next} />
        <GoogleButton next={next} />
        <EmailOption>
          <form
            className={formClass}
            onSubmit={(event) => {
              const v = formValues(event, "email", "password");
              void email.run(() => signInWithEmail(v["email"] ?? "", v["password"] ?? ""));
            }}
          >
            <Field label="Email" name="email" type="email" autoComplete="username webauthn" />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              aside={<Link href="/forgot-password">Forgot password?</Link>}
            />
            <Message text={email.error} />
            <Button busy={email.busy}>Sign in</Button>
          </form>
        </EmailOption>
      </div>
      <p className="auth-footer">
        No account? <Link href="/signup">Create one</Link>
      </p>
    </>
  );
}
