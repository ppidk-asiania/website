# @website/apikeys

API keys, scopes and rate limiting for the gateway.

## Responsibilities

- Key format `pk_<env>_<id>_<secret>`; only an HMAC of the secret is stored
- Verification (revoked, expired, wrong environment) and scope checks
- Rate-limiter port with an in-memory implementation for development

## Structure

| File                | Contains                                                   |
| ------------------- | ---------------------------------------------------------- |
| `src/keys.ts`       | `generateApiKey`, `verifyApiKey`, `hasScope`, `API_SCOPES` |
| `src/rate-limit.ts` | `RateLimiter` port, `createInMemoryRateLimiter`            |

## Rules

- The in-memory limiter is per instance — use a managed store in production.

## Commands

```bash
pnpm --filter @website/apikeys lint
pnpm --filter @website/apikeys typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
