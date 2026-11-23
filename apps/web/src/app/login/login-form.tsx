"use client";

import Link from "next/link";
import { signInWithEmail, signInWithPasskey } from "@/lib/auth-client";
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

export function LoginForm({ next }: { next: string | null }) {
  const email = useAuthAction(next);
  const passkey = useAuthAction(next);
  return (
    <>
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
      <AuthSeparator />
      <div className={formClass}>
        <GoogleButton next={next} />
        <Button
          type="button"
          outline
          busy={passkey.busy}
          onClick={() => void passkey.run(signInWithPasskey)}
        >
          Sign in with a passkey
        </Button>
        <Message text={passkey.error} />
      </div>
      <p className="auth-footer">
        No account? <Link href="/signup">Create one</Link>
      </p>
    </>
  );
}
