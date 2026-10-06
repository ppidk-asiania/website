# @website/auth

Identity: who the user is. Never what they may do.

## Responsibilities

- Session cookie policy (`__Host-session`, one per app)
- `IdentityProvider` port and the Firebase Admin adapter
- Recent-sign-in check for sensitive actions

## Structure

| Import                         | Contains                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `@website/auth`                | `SESSION_COOKIE`, `sessionCookieOptions`, `IdentityProvider`, `isRecentSignIn` |
| `@website/auth/firebase-admin` | `createFirebaseIdentityProvider()` (server only)                               |

## Rules

- Authorization is not here — see `@website/permissions`.
- The Firebase adapter refuses to run in browser bundles.

## Commands

```bash
pnpm --filter @website/auth lint
pnpm --filter @website/auth typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
