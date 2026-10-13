# shop

Online shop: products, categories, cart, checkout and orders.

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
| `src/app/api/session/route.ts` | Sign-in/out: Google OAuth ID token → HttpOnly session cookie (`src/server/session.ts`).                      |
| `src/server/`                  | Server-only code: env, database, payment provider.                                                           |
| `.env.example`                 | Variables this app needs.                                                                                    |

## Rules

- Domain `shop.example.org`, local port **3002**.
- Depends only on `@website/domain/shop` (extraction boundary — enforced by lint).
- Money is always integer minor units; the payment provider is the source of truth for payments.

## Commands

```bash
pnpm --filter shop dev      # http://localhost:3002
pnpm --filter shop build
pnpm --filter shop lint
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
