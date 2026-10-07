import type { Metadata } from "next";
import { AppShell } from "@website/ui";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AppShell title="Reset your password">
      <ForgotPasswordForm />
    </AppShell>
  );
}
