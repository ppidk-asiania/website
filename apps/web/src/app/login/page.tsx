import type { Metadata } from "next";
import { AppShell } from "@website/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <AppShell title="Sign in">
      <LoginForm />
    </AppShell>
  );
}
