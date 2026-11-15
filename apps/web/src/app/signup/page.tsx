import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-form";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default function SignUpPage() {
  return (
    <AuthCard title="Create account" subtitle="Get started with your account">
      <SignUpForm />
    </AuthCard>
  );
}
