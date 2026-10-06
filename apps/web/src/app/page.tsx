import { AppShell, StatusBadge } from "@platform/ui";

// Public pages are static/ISR so they keep serving even if admin, shop or the database is down.
export const revalidate = 300;

export default function HomePage() {
  return (
    <AppShell title="Public website">
      <p>
        <StatusBadge label="web: ok" status="ok" />
      </p>
      <p>News, articles, events, gallery, organization and chapters will live here.</p>
    </AppShell>
  );
}
