import { NextResponse, type NextRequest } from "next/server";
import { isMaintenanceExempt, maintenanceResponse } from "./lib/maintenance";
import { guardRequest, signInRedirect, verificationTarget } from "./server/request-guard";

// Read once per process, like every variable on cPanel: changing it means a restart.
const maintenance = process.env["MAINTENANCE_MODE"] === "true";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Before the rate-limit store: the page must work while the database is being copied.
  if (
    maintenance &&
    !isMaintenanceExempt(pathname) &&
    verificationTarget(request, pathname) === null
  ) {
    return maintenanceResponse(pathname);
  }
  const { blocked, headers } = await guardRequest(request);
  if (blocked) return blocked;
  const signIn = signInRedirect(request);
  const rewrite = verificationTarget(request, request.nextUrl.pathname);
  const response = signIn
    ? NextResponse.redirect(new URL(signIn, request.url))
    : rewrite
      ? NextResponse.rewrite(new URL(rewrite, request.url))
      : NextResponse.next();
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|map|txt|xml|woff2?)$).*)",
  ],
};
