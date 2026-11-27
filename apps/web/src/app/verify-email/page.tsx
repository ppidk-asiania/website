import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth-form";
import { verifyEmail } from "@/server/session";

export const metadata: Metadata = { title: "Confirm your e-mail", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard>
      <Suspense fallback={<p className="auth-footer">Checking the link…</p>}>
        <Outcome searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Outcome({ searchParams }: { searchParams: SearchParams }) {
  const token = (await searchParams)["token"];
  const verified = typeof token === "string" && token.length <= 1024 && (await verifyEmail(token));
  return (
    <div className="auth-card__head">
      <h1>{verified ? "E-mail confirmed" : "This link does not work"}</h1>
      <p>
        {verified
          ? "Thank you. Your e-mail address is confirmed."
          : "It has expired, was for an address you have since changed, or is incomplete."}
      </p>
      <p className="auth-footer">
        <Link href="/settings/account">Go to your account</Link>
      </p>
    </div>
  );
}
