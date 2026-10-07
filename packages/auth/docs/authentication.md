# Authentication

**One Firebase Authentication user pool for everyone** — staff, members and shop customers —
per environment (`ppidk-website-staging`, `ppidk-website-prod`). Firebase says _who_ someone
is; _what_ they may do comes only from RBAC role assignments in Firestore (`users/{uid}`).

## Sign-in methods

- Google and email/password for all users (email must be verified before a profile can be saved).
- Staff accounts (any role with `admin.access`) must have MFA enabled before the role is granted.

## Account lifecycle

1. Anyone may create an account. On first sign-in the server creates `users/{uid}` with
   the default role `user` (self-service only).
2. Completing the member profile + approval by a `chapter_admin`/`admin` adds `member`.
3. Staff roles are granted only by holders of `users.manage` (superadmin), never by sign-up.
   **There is no way to self-register into the admin area.**

## Sessions

```text
browser (Firebase client SDK) ─ ID token ─▶ POST /api/session on the SAME app (same-origin)
   server: verifyIdToken(checkRevoked) + require fresh sign-in (≤ 5 min)
         → createSessionCookie (8 h default, max 12)
         → Set-Cookie: __Host-session; HttpOnly; Secure; SameSite=Lax; Path=/
every request: cookie → verifySessionCookie(checkRevoked) → users/{uid} roles → Principal
```

- Same accounts everywhere, but **separate cookies per app** (`__Host-` = host-only):
  a session on `shop.` or `web.` is never sent to `admin.`.
- Admin additionally requires a staff role (`canAccessAdmin`); members get "not authorized".
- Endpoint (web, admin, shop): `POST /api/session` with `{ "idToken": "<Firebase ID token>" }` →
  `204` + cookie; invalid body `400`; invalid/expired token `401` (reason not disclosed).
  `DELETE /api/session` → revokes all sessions of the user and clears the cookie.
  Implemented once in `packages/auth/src/session-routes.ts`; each app's `src/app/api/session/route.ts` wires it.
- The body accepts only `idToken` — the uid always comes from the verified token.
- Sign-out and role changes revoke refresh tokens (`revokeSessions`).
- Sensitive actions require a recent sign-in (`isRecentSignIn`, ≤ 15 min).
- `proxy.ts` (middleware) is never relied on for authentication or authorization.
- Custom Claims are not used for authorization.
