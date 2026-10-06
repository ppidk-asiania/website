# @website/observability

Structured logging and security events.

## Responsibilities

- JSON logger with automatic redaction of secrets
- Request ID handling
- Security event logging (logins, role changes, reverts, exports)

## Structure

| Export               | Purpose                              |
| -------------------- | ------------------------------------ |
| `createLogger()`     | Structured logger                    |
| `resolveRequestId()` | Safe inbound request ID or a new one |
| `logSecurityEvent()` | Alertable security log entry         |

## Rules

- Never log personal data or credentials.

## Commands

```bash
pnpm --filter @website/observability lint
pnpm --filter @website/observability typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
