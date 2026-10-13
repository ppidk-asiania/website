# @website/db

Firestore access, exposed per application role.

## Responsibilities

- Implements the repository ports declared in `@website/domain`
- Gives each app only the repositories its role allows (`web_ro`, `admin_rw`, `shop_rw`, `gateway_rw`)
- In-memory repositories for development and tests

## Structure

| Import                  | Contains                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@website/db`           | Role types and repository sets per role                                                                            |
| `@website/db/firestore` | `getFirestoreForRole()` (the only place Firestore is imported), rate-limit and passkey stores, `getDocumentsByIds` |
| `@website/db/memory`    | In-memory repositories for tests and local development                                                             |

## Rules

- Server-only. Apps import it only from `src/server/**`.
- Runs the staging/production isolation guard before connecting.

## Commands

```bash
pnpm --filter @website/db lint
pnpm --filter @website/db typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
