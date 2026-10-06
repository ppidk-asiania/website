# @website/contracts

Request and response schemas of the public API.

## Responsibilities

- Zod schemas for the gateway's DTOs, errors (RFC 9457) and pagination
- The API version list

## Structure

| Folder                           | Contains                           |
| -------------------------------- | ---------------------------------- |
| `src/events/`                    | Event DTO, list query, page        |
| `src/registrations/`             | Registration request/response      |
| `src/errors/`                    | Problem Details and problem types  |
| `src/pagination/`, `src/health/` | Cursor pagination, health response |

## Rules

- A breaking change needs a new API version; never edit `v1` shapes incompatibly.
- DTOs list fields explicitly — internal fields must never leak.

## Commands

```bash
pnpm --filter @website/contracts lint
pnpm --filter @website/contracts typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
