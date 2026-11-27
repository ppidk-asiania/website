# @website/config

Environment validation and shared TypeScript configuration.

## Responsibilities

- Zod schemas for every environment variable group
- Shared `tsconfig` bases (`base`, `library`, `node`, `nextjs`)

## Structure

| Import                            | Contains                          |
| --------------------------------- | --------------------------------- |
| `@website/config`                 | `APP_ENVIRONMENTS`                |
| `@website/config/env`             | Env schemas, `loadEnv`, `lazyEnv` |
| `@website/config/tsconfig/*.json` | TypeScript bases                  |

## Rules

- Env is validated lazily at first use, never at build time.

## Commands

```bash
pnpm --filter @website/config lint
pnpm --filter @website/config typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
