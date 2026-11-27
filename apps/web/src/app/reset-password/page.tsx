import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth-form";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard
      title="Choose a new password"
      subtitle="You will be signed in with it, and signed out everywhere else."
    >
      <Suspense fallback={<ResetPasswordForm token="" />}>
        <WithToken searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function WithToken({ searchParams }: { searchParams: SearchParams }) {
  const token = (await searchParams)["token"];
  return <ResetPasswordForm token={typeof token === "string" ? token : ""} />;
}
