# @website/auth

Identity: who the user is. Never what they may do.

## Responsibilities

- Session cookie policy (`__Secure-session`, one session shared by web, admin and shop)
- `safeReturnUrl()`: validates `/login?next=…` targets (no open redirect)
- Sign-in accounts: `AuthAccountStore` port (MySQL adapter in `@website/db/sql`), signed session
  cookies (`createIdentityProvider`), Google ID token check, scrypt passwords, e-mail links
  (`createSignIn`), account admin for Role Manager and web settings (`createAccountAdmin`,
  `createAccountCreator`)
- Recent-sign-in check for sensitive actions
- Session endpoints and passkey (WebAuthn) registration/sign-in

## Structure

| File                    | Contains                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `src/session.ts`        | `SESSION_COOKIE`, `IdentityProvider`, `AuthAccount` / `AuthAccountStore` ports, `isRecentSignIn` |
| `src/identity.ts`       | `createIdentityProvider` (session cookies), `createAccountAdmin`, `createAccountCreator`         |
| `src/sign-in.ts`        | `createSignIn` (Google, password, sign-up, reset, verify), `verifyGoogleIdToken`, `hashPassword` |
| `src/session-routes.ts` | `createSessionRoutes` (`POST`/`DELETE /api/session`, `start` for passkeys)                       |
| `src/passkeys.ts`       | `createPasskeyRoutes`, `PasskeyStore`                                                            |

Everything is exported from `@website/auth` (server code only: it uses `node:crypto`).

## Rules

- Authorization is not here — see `@website/permissions`.
- Sessions and e-mail links are signed with `SESSION_SECRET`; every session check reads the
  account, so disabling it or signing out ends sessions everywhere at once.

## Commands

```bash
pnpm --filter @website/auth lint
pnpm --filter @website/auth typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
