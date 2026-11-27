# store

Online store: products, categories, cart, checkout and orders.

## Responsibilities

- Product catalog and categories
- Cart and hosted checkout (card data never touches our servers)
- Orders and the customer's own order history
- Payment-provider webhooks

## Structure

| Path                           | Purpose                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/app/`                     | Pages (App Router).                                                                                          |
| `src/proxy.ts`                 | Runs before every request: origin check, per-IP rate limit, private caching (`src/server/request-guard.ts`). |
| `src/app/api/session/route.ts` | Sign-out (sign-in happens on web) — clears the shared session cookie (`src/server/session.ts`).              |
| `src/server/`                  | Server-only code: env, database, payment provider.                                                           |
| `.env.example`                 | Variables this app needs.                                                                                    |

## Rules

- Domain `store.example.org`, local port **3002**.
- Depends only on `@website/domain/store` (extraction boundary — enforced by lint).
- Money is always integer minor units; the payment provider is the source of truth for payments.

## Commands

```bash
pnpm --filter store dev      # http://localhost:3002
pnpm --filter store build
pnpm --filter store lint
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
