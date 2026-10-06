# Database

## Status: abstraction first, data model next

The final data model is **not** decided yet. Firestore is the initial store for content, events,
organizations and newsletter data; the shop may move to PostgreSQL if it needs relational
guarantees (orders, inventory, refunds, reporting). The code is structured so that change is local.

## Rules

- **Ports in `domain`**: each module declares the repository interfaces it needs
  (`ContentReader`, `EventReader`, `ChapterReader`, …). Domain code never sees Firestore.
- **Adapters in `db`**: Firestore is imported only in `packages/db/src/firestore/**` (lint-enforced).
- **Per-role access**: `@platform/db` exposes repositories per `DatabaseRole`
  (`web_ro`, `admin_rw`, `shop_rw`, `gateway_rw`). `web` cannot obtain a writer — by type.
- **No UI database access**: apps reach `@platform/db` only from `src/server/**`.

## Roles → credentials

| Role         | App     | Firestore (now)                               | PostgreSQL (if adopted)                                |
| ------------ | ------- | --------------------------------------------- | ------------------------------------------------------ |
| `web_ro`     | web     | Service account with `roles/datastore.viewer` | SELECT on published views                              |
| `admin_rw`   | admin   | SA with `roles/datastore.user`                | RW on content/org/events schemas, INSERT-only on audit |
| `shop_rw`    | shop    | SA scoped to shop data                        | RW on `shop` schema only                               |
| `gateway_rw` | gateway | SA, read events + write registrations         | Own role + capped pool (`GATEWAY_DB_MAX_CONNECTIONS`)  |

Firestore IAM is project-wide, so least privilege per collection is enforced in code (role
repositories), not by IAM. This is a known weakness and one input to the PostgreSQL decision.

## Entity conventions

Every editable entity has `id`, `version` (optimistic concurrency), `createdAt`, `updatedAt`,
`deletedAt` (soft delete). Writes are conditional on `version`.

## Decision checklist (next phase)

- [ ] Model registrations (uniqueness per event+email, capacity) and reporting needs
- [ ] Decide shop store: hosted commerce vs Firestore vs PostgreSQL
- [ ] Decide audit store (append-only enforcement is weaker on Firestore)
