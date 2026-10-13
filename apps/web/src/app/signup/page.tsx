import type { Metadata } from "next";
import { AppShell } from "@website/ui";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default function SignUpPage() {
  return (
    <AppShell title="Create account">
      <SignUpForm />
    </AppShell>
  );
}
