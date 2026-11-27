# Authentication

**One user pool for everyone** — staff, members and store customers — kept in MySQL
(`authAccounts/{uid}`, see `packages/db/docs/database.md`) and used by every environment. The
account says _who_ someone is; _what_ they may do comes only from RBAC role assignments in MySQL
(`users/{uid}`). No third-party identity service holds accounts or sessions: Google is only asked to
prove a Google account (Sign in with Google, Google Identity Services).

## Sign-in methods

| Method           | Sign up                                                                              | Sign in                                                         | Where                                |
| ---------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------ |
| Google           | `/signup` or `/login` → "Continue with Google" (same action)                         | same                                                            | Google Identity Services, our server |
| Email + password | `/signup` (8+ characters, confirmation; verification email sent)                     | `/login`                                                        | Our server (scrypt hash)             |
| Passkey          | Added from `/settings/account` after signing in (needs a sign-in in the last 15 min) | `/login` → "Continue with passkey"                              | Our server (WebAuthn)                |
| Forgot password  | —                                                                                    | `/forgot-password` → e-mail link → `/reset-password` (signs in) | Our server                           |

- Email must be verified before a member profile can be saved. Google proves it; a password
  account proves it with the link e-mailed at sign-up (`/verify-email`, valid 3 days) or with a
  password reset.
- Staff roles (any role that opens an admin page) are only granted to accounts with **two sign-in
  methods**: a passkey plus Google or a password (`hasTwoSignInMethods`). Web `/settings/account`
  lists the account's methods (`createAccountAdmin` + our passkeys).
- Pages live in `apps/web/src/app/{login,signup,forgot-password,reset-password,verify-email,settings}`;
  browser logic in `apps/web/src/lib/auth-client.ts`. The browser keeps no token: every sign-in
  ends in the HttpOnly session cookie.
- Error messages never reveal whether an email has an account (`apps/web/src/lib/auth-errors.ts`);
  a wrong e-mail and a wrong password get the same `401`, and the reset form always shows the same
  confirmation. Sign-up of an address that already has an account answers `409` ("sign in or
  reset your password"), as before.

## Google (Google Identity Services)

```text
/login → https://accounts.google.com/gsi/client draws Google's button (popup), invisible over
         our own "Continue with Google" button so it looks like the other sign-in buttons
       → Google returns an ID token ("credential") to the page
       → POST /api/session { method: "google", credential }
server: verifyGoogleIdToken — RS256 signature against Google's keys
        (https://www.googleapis.com/oauth2/v3/certs, cached for Cache-Control max-age),
        iss accounts.google.com, aud = NEXT_PUBLIC_GOOGLE_CLIENT_ID, not expired, email_verified
```

- The account is found by the Google account (`sub`), else by the verified e-mail (Google is
  then linked to it), else created. When Google proves the e-mail of an account whose address was
  never verified, that account's password is removed and its sessions end: someone who signed up
  with another person's address cannot keep a way in.
- Setup: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application);
  add every `WEB_URL` (and `http://localhost:3000` for development) to **Authorized JavaScript
  origins**; put the client id in `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web, also at build time).

## E-mail and password

- Passwords are stored only as a scrypt hash (`hashPassword`, N = 32768, r = 8, p = 1, 16-byte
  salt). A missing account is checked against a dummy hash, so it takes as long as a wrong
  password.
- Verification and reset links are signed with `SESSION_SECRET` (`signLink`); a reset link is
  valid 1 hour and only until the password changes (single use). A reset sets the new password,
  marks the e-mail verified, ends every other session and signs the person in.
- Links are sent straight through the e-mail channel (Resend), not the messenger, so no working
  link is kept in the message log. `MESSAGING_MODE` and `MESSAGING_TEST_RECIPIENTS` still apply;
  with `APP_ENV=development` a link that is not sent is printed in the server log.
- Accounts created without a way to sign in (Role Manager "Add New People", the WhatsApp chatbot,
  the PPIDK import) get one by signing in with Google using that address, or by "Forgot password".
- Throttling: `POST /api/session` has its own per-IP limit on the web app (10 a minute, 200 a
  day; `apps/web/src/server/request-guard.ts`) on top of the general request guard.

## Passkeys

The web server verifies WebAuthn itself (`packages/auth/src/passkeys.ts`, library
`@simplewebauthn/server`) and then starts the session directly:

```text
add:     /settings/account → POST /api/passkeys/register-options (session + recent sign-in)
         → browser creates passkey → POST /api/passkeys/register-verify → saved in passkeys/{hash}
sign in: POST /api/passkeys/login-options → browser signs → POST /api/passkeys/login-verify
         → 204 + session cookie (`createSessionRoutes(...).start(uid, "passkey")`)
```

- Passkeys are bound to the hostname of `WEB_URL` and require user verification (biometric/PIN).
- Each challenge is stored server-side (`webauthnChallenges`), referenced by an HttpOnly
  `__Host-passkey-challenge` cookie, valid 5 minutes and **single-use** (atomic read-and-delete),
  so assertions cannot be replayed even by concurrent requests.
- The signature counter is updated atomically and must increase (0 → 0 allowed for synced
  passkeys); a lower value is treated as a cloned authenticator and refused.
- Failures always return the same `401` — the response never says why.
- Names and removal (`/settings/account`): `register-verify` also takes an optional `name`
  (≤ 32 characters, `safeText`) and stores the browser/system from the User-Agent
  (`deviceLabel`, e.g. "Chrome · macOS"). `POST /api/passkeys/rename` `{id, name}` needs a session;
  `POST /api/passkeys/delete` `{id}` needs a sign-in in the last 15 minutes. Both act only on the
  caller's own passkey, and a passkey is never removed when it is the account's last way to sign
  in (no Google/password and no other passkey → `409`).

## Own account settings (web `/settings/account`)

`apps/web/src/server/own-account.ts`; every change needs a sign-in in the last 15 minutes.

- **E-mail codes**: a 4-digit code, sent through the messenger, valid 15 minutes, 5 tries
  (`accountEmails/{uid}`, hashed). A _backup_ address is saved at once and marked verified by its
  code (it is not used for recovery or notices yet). A new _primary_ address is set on the
  sign-in account only after its code is right (`changeEmail` also ends every session, so the person signs in
  again). An unverified primary address proves itself with the same code.
- **Disconnect Google**: removes the Google link (`unlinkProvider`), refused when Google is the
  only way in.
- **Delete account** (anonymise, decided 27 Nov 2026): typed "DELETE ACCOUNT"; refused while the
  account holds any role other than visitor (staff/officer roles are ended in Role Manager or by
  the appointment first). Deletes the member profile and its proof files, WhatsApp link codes,
  signature, passkeys and `accountEmails`, sets `users/{uid}` to inactive without name, e-mail or
  roles (`closedAt`), audits both deletions without personal data, then deletes the sign-in account.
  Registrations, letters, certificates and audit entries stay. Safe to retry.

## Account lifecycle

1. Anyone may create an account. Every sign-in method ends in web `POST /api/session`; after the
   session cookie is created, `onSignIn` (from `createSessionRoutes`) reads the uid back from that
   verified cookie and `recordSignIn` creates `users/{uid}` with the default role `visitor`
   (self-service only) the first time, and updates `lastSignInAt` every time. If that write fails,
   the sign-in fails (no cookie).
2. There is no separate member role: every account is a **Visitor** (`visitor`).
3. Staff roles are granted only by holders of `users.edit` who hold every permission of that role (superadmin only by a superadmin), never by sign-up.
   **There is no way to self-register into the admin area.**
4. **Bootstrap** — the first superadmin: the person signs in on web once, then the owner runs
   `node --env-file=apps/admin/.env.local infrastructure/scripts/grant-superadmin.mjs --email <address>`
   (dry run; repeat `--email` for several people), then again with `--apply`. It needs only
   `DATABASE_URL` (the account is found by its e-mail in `users`) and writes an audit-log entry.
   Later superadmins are granted in the admin Role Manager.
   For test accounts without real member data, `infrastructure/scripts/seed-dummy-profile.mjs`
   (same flags) writes a placeholder profile; it never overwrites a complete profile.
5. Too many wrong passwords: the web request guard limits `POST /api/session` per IP (`429`,
   shown as "Too many attempts…"). There is no per-account lockout, so nobody can lock another
   person out by guessing.
6. Fresh start (27 Nov 2026): accounts of the former Firebase user pool were not carried over;
   everyone signs in again and gets a new uid, and roles are granted again in Role Manager.
   Their leftover `users` rows (with profiles, passkeys and roles) are cleaned with
   `node --env-file=apps/admin/.env.local infrastructure/scripts/remove-old-accounts.mjs`: a dry
   run lists them, `--apply` removes their personal data, passkeys and roles and keeps an
   anonymous, audited `users` row (like deleting one's own account). PPIDK imports are left out.

## Sessions

**One session for every app** (DEC-13): sign in once on the web app and you are signed in on
admin and store too; signing out in any app signs you out of all of them.

```text
browser ─ Google credential / e-mail + password / reset token ─▶ web POST /api/session
   server: verify the credential → uid (createSignIn)
         → createSession: signLink({ uid, provider, at }, SESSION_SECRET), 8 h default, max 12
         → Set-Cookie: __Secure-session; Domain=<SESSION_COOKIE_DOMAIN>; HttpOnly; Secure; SameSite=Lax; Path=/
every request, every app: cookie → signature + expiry → authAccounts/{uid} (exists, not disabled,
   started after sessionsValidAfter) → users/{uid} roles → Principal
```

- The cookie is set on the parent domain (`SESSION_COOKIE_DOMAIN`, e.g. `ppiasiania.id`), so web,
  admin and store all receive it. It stays HttpOnly (scripts cannot read it), Secure and
  SameSite=Lax. Without a domain (local development) it is host-only; `localhost` apps still share
  it because cookies ignore the port.
- Sharing the session does **not** share permissions: admin still requires a staff role
  (`canAccessAdmin`), staff need two sign-in methods, and sensitive actions need a recent sign-in.
- Sign-in happens on the web app. A signed-out visitor who opens a login-required page in any app
  is redirected (307) to `WEB_URL/login?next=<that page's URL>` (`signInUrl`). After signing in the
  web app returns there only if `safeReturnUrl` accepts the target (a relative path, or a URL on
  WEB_URL / ADMIN_URL / STORE_URL — no open redirect). Admin needs `WEB_URL` and `ADMIN_URL` set for
  the redirect; without them it shows "sign-in required" instead.
- That redirect is sent by each app's `src/proxy.ts` (`signInRedirect` in
  `src/server/request-guard.ts`) when the session cookie is missing, before the page renders. With
  Cache Components a page's own `redirect()` is streamed (200 + client-side redirect), so the
  proxy is what makes it a real 307. The page still verifies the session and permissions.
- Endpoint (web): `POST /api/session` with one of `{ method: "google", credential }`,
  `{ method: "password", email, password }`, `{ method: "signup", email, password }`,
  `{ method: "reset-request", email }` (always `204`, no cookie) or
  `{ method: "reset", token, password }` → `204` + cookie; invalid body `400`; wrong credentials
  or an expired link `401` (reason not disclosed); sign-up of a taken address `409`.
  `DELETE /api/session` (web, admin, store) → ends all sessions of the user and clears the cookie
  (same Domain). Admin and store have no `POST`: sign-in happens on the web app. Implemented once
  in `packages/auth/src/session-routes.ts`; each app's `src/app/api/session/route.ts` wires it.
- Use the same `SESSION_SECRET`, `SESSION_MAX_AGE_HOURS` and `SESSION_COOKIE_DOMAIN` in web, admin
  and store. Changing `SESSION_SECRET` signs everybody out and voids unused e-mail links.
- The bodies are `.strict()` — the uid always comes from the verified credential, never the body.
- Sign-out, deactivation, e-mail changes and role changes call `revokeSessions`, which sets
  `sessionsValidAfter` on the account and so ends its sessions in every app at once.
- Sensitive actions require a recent sign-in (`isRecentSignIn`, ≤ 15 min).
- `proxy.ts` (middleware) is never relied on for authentication or authorization: it only checks
  that a session cookie exists (for the sign-in redirect); pages verify it.
- Custom Claims are not used for authorization.
- Keep DNS clean: every subdomain of `SESSION_COOKIE_DOMAIN` receives the cookie, so remove
  records that point to services we no longer control (subdomain takeover).
