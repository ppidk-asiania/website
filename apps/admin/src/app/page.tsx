import { AppShell, StatusBadge } from "@website/ui";
import { getPrincipal } from "@/server/context";

// Never cache admin pages: every request is authenticated server-side.
export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const principal = await getPrincipal();
  return (
    <AppShell title="Admin">
      <p>
        <StatusBadge label="admin: ok" status="ok" />
      </p>
      <p data-testid="auth-state">
        {principal ? "Signed in" : "Not signed in — sign-in required."}
      </p>
    </AppShell>
  );
}
