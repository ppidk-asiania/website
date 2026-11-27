import type { Metadata } from "next";
import { Suspense } from "react";
import { safeReturnUrl } from "@website/auth";
import { AuthCard } from "@/components/auth-form";
import { getAppUrls } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard>
      <Suspense fallback={<LoginForm next={null} />}>
        <LoginWithReturn searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function LoginWithReturn({ searchParams }: { searchParams: SearchParams }) {
  const next = (await searchParams)["next"];
  if (typeof next !== "string") return <LoginForm next={null} />;
  const urls = getAppUrls();
  const allowed = [urls.WEB_URL, urls.ADMIN_URL, urls.SHOP_URL].filter(
    (url): url is string => url !== undefined,
  );
  return <LoginForm next={safeReturnUrl(next, allowed)} />;
}
