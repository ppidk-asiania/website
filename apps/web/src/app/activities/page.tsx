import type { Metadata } from "next";
import { Suspense } from "react";
import { Highlights } from "@/components/highlights";
import { LinesSkeleton } from "@/components/site-skeleton";
import { Localized } from "@/i18n/localized";

export const metadata: Metadata = { title: "Activities" };

export default function ActivitiesPage() {
  return (
    <main className="ui-shell">
      <Localized render={(t) => <h1 className="ui-shell-title">{t.pages.activities}</h1>} />
      <Suspense fallback={<LinesSkeleton />}>
        <Highlights all />
      </Suspense>
    </main>
  );
}
