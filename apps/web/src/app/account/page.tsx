import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@website/ui";
import { getSignedInUser } from "@/server/session";
import { AccountActions } from "./account-actions";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default async function AccountPage() {
  const user = await getSignedInUser();
  if (!user) redirect("/login");
  return (
    <AppShell title="Your account">
      <p>Signed in as {user.email ?? "your account"}.</p>
      {!user.emailVerified && <p>Please verify your email address — check your inbox.</p>}
      <AccountActions />
    </AppShell>
  );
}
