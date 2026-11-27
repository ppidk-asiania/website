"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { NavigationProgress } from "@website/ui";

export function RouteProgress() {
  return <NavigationProgress route={`${usePathname()}?${useSearchParams()}`} />;
}
