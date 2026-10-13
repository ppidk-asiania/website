import { sessionRoutes } from "@/server/session";

/** Sign in: exchange a Firebase (Google OAuth) ID token for an HttpOnly session cookie. */
export function POST(request: Request) {
  return sessionRoutes().POST(request);
}

/** Sign out: revoke sessions and clear the cookie. */
export function DELETE(request: Request) {
  return sessionRoutes().DELETE(request);
}
