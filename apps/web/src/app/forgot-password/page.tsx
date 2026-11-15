import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-form";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we will send you a link to choose a new password."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
