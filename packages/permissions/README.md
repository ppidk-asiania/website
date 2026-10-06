# @website/permissions

Role-based access control (RBAC), evaluated on the server.

## Responsibilities

- The permission vocabulary and role → permission map
- `can()`, `requirePermission()`, `canAccessAdmin()`, `canAssignRole()`
- Chapter-scoped roles and `*_own` (ownership) permissions

## Structure

| File                 | Contains                                            |
| -------------------- | --------------------------------------------------- |
| `src/permissions.ts` | `PERMISSIONS`, `ROLES`, `ROLE_PERMISSIONS`          |
| `src/policy.ts`      | `Principal`, checks, default roles for new accounts |

## Rules

- Deny by default. Adding a permission or role is a reviewed code change.
- Never derive roles from client input or token claims.

## Commands

```bash
pnpm --filter @website/permissions lint
pnpm --filter @website/permissions typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
