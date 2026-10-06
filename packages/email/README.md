# @website/email

Sending email through a provider-neutral port.

## Responsibilities

- `EmailSender` port
- Resend adapter (plain `fetch`, 5 s timeout, idempotency key)
- In-memory adapter for development and tests

## Structure

| Export                 | Purpose                             |
| ---------------------- | ----------------------------------- |
| `createResendSender()` | Production sender                   |
| `createMemorySender()` | Records messages instead of sending |

## Rules

- No queue: callers record failures and staff retry manually.

## Commands

```bash
pnpm --filter @website/email lint
pnpm --filter @website/email typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
