# Authentication

Firebase Authentication provides **identity only** (who someone is). What they may do is
decided by `@platform/permissions` from records in our database.

## Populations

| Who           | Sign-in                                                               | Where             |
| ------------- | --------------------------------------------------------------------- | ----------------- |
| Staff         | Google (preferably org Workspace) + MFA; email/password only with MFA | admin.example.org |
| Customers     | Google or email/password                                              | shop.example.org  |
| Third parties | API keys (not Firebase)                                               | api.example.org   |

No public admin registration: Firebase lets anyone create an account, so a Firebase account
means nothing until a superadmin has created a matching **staff record**. No record → no access
(`denyAllStaffDirectory` fails closed until the directory is implemented).

## Staff session flow

```text
browser (Firebase client SDK) ─ ID token ─▶ POST admin /api/session (same-origin)
   server: verifyIdToken(checkRevoked) + require fresh sign-in (≤5 min)
         → createSessionCookie (8 h default, max 12)
         → Set-Cookie: __Host-staff_session; HttpOnly; Secure; SameSite=Lax; Path=/
every request: getPrincipal()
   cookie → verifySessionCookie(cookie, checkRevoked=true) → staff record + roles from DB
```

- The cookie is host-only on `admin.` and never sent to web/shop/api.
- Sign-out and role changes revoke refresh tokens (`revokeSessions`).
- Sensitive actions require `isRecentSignIn` (≤15 min).
- `proxy.ts` (formerly middleware) is never relied on for authentication or authorization.

## Custom Claims

Not used for authorization (1000-byte limit, stale until token refresh, not audited). At most a
`staff: true` hint for client-side routing UX.
