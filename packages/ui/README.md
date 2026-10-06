# @website/ui

Shared presentational React components.

## Responsibilities

- Layout and small UI building blocks used by web, admin and shop

## Structure

| Export        | Purpose                |
| ------------- | ---------------------- |
| `AppShell`    | Page layout with title |
| `StatusBadge` | Small status label     |

## Rules

- Components never fetch data, read env or make authorization decisions.

## Commands

```bash
pnpm --filter @website/ui lint
pnpm --filter @website/ui typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
