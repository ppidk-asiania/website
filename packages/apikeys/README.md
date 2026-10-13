# @website/apikeys

API keys and scopes for the gateway.

## Responsibilities

- Key format `pk_<env>_<id>_<secret>`; only an HMAC of the secret is stored
- Verification (revoked, expired, wrong environment) and scope checks

## Structure

| File          | Contains                                                   |
| ------------- | ---------------------------------------------------------- |
| `src/keys.ts` | `generateApiKey`, `verifyApiKey`, `hasScope`, `API_SCOPES` |

## Rules

- Rate limiting lives in `@website/security` (per IP and per key).

## Commands

```bash
pnpm --filter @website/apikeys lint
pnpm --filter @website/apikeys typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
