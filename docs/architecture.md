# Architecture

## Shape

One monorepo, four independently deployed applications, shared packages. No microservices,
no queues, no self-managed workers.

```text
                 web.example.org    admin.example.org   shop.example.org    api.example.org
                 apps/web           apps/admin          apps/shop           apps/gateway
                 (Next.js, ISR)     (Next.js, SSR)      (Next.js)           (Hono, /v1)
                      │                  │                   │                   │
                      └──────────────────┴─────────┬─────────┴───────────────────┘
                                                   │  in-process imports (no shared API service)
               packages/: domain · db · auth · permissions · audit · contracts · apikeys
                          email · ui · observability · config
                                                   │
                      Firebase Auth · Firestore (behind @platform/db) · Storage · Resend · payment provider
```

Each app is its own Vercel project and failure boundary. A broken admin deploy cannot take
down the public site; the public site serves cached (ISR) pages even if the database is down.

## Applications

| App            | Responsibility                                                                                            | Must never                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web`     | Public pages: landing, news, articles, events, gallery, organization, chapters                            | Contain admin functionality or staff auth                             |
| `apps/admin`   | CMS, galleries, events, newsletter, organization, users, audit/revert, QR, Zoom, calendar tools           | Trust client state; write to Firestore from the browser               |
| `apps/shop`    | Products, categories, cart, checkout (hosted), orders, customer account                                   | Import non-shop domain modules                                        |
| `apps/gateway` | The **only** entry point for third-party systems: `/v1`, API keys, scopes, rate limits, OpenAPI, RFC 9457 | Import staff auth/session, admin authorization, audit internals or UI |

Internal Server Actions and Route Handlers in web/admin/shop are same-origin only and undocumented.

## Packages

| Package         | Responsibility                                                                                          | Depends on                    |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `config`        | Zod env schemas, environment-isolation guard, shared tsconfigs                                          | —                             |
| `contracts`     | External API DTOs, errors (RFC 9457), pagination, versions (Zod → OpenAPI)                              | —                             |
| `domain`        | Business rules + ports, by module: `content`, `events`, `organizations`, `newsletter`, `shop`, `shared` | —                             |
| `permissions`   | Roles, permissions, scoped `can()` / `requirePermission()`                                              | —                             |
| `audit`         | Append-only audit event model, diff, revert policy (14 days)                                            | —                             |
| `apikeys`       | Third-party key format, hashing, verification, scopes, rate-limit port                                  | —                             |
| `email`         | `EmailSender` port, Resend adapter, in-memory adapter                                                   | —                             |
| `observability` | Structured logging with redaction, request IDs, security events                                         | —                             |
| `ui`            | Presentational React components (no data access, no auth decisions)                                     | —                             |
| `auth`          | Identity port, session cookie policy, Firebase Admin adapter                                            | `config`                      |
| `db`            | Database access per role; Firestore confined to `src/firestore/`                                        | `domain`, `config`, `apikeys` |

Audit logic lives only in `packages/audit` (not also in `domain/audit`) so there is one owner.

## Dependency rules

Enforced by tooling, not just this document:

1. **`scripts/check-boundaries.mjs`** (run by `pnpm lint` and CI): workspace dependency matrix,
   no undeclared (`phantom`) imports, no relative imports escaping a workspace, subpath rules,
   no cycles. `node scripts/check-boundaries.mjs --graph` prints the graph.
2. **ESLint `no-restricted-imports`** (`eslint.config.mjs`): per-folder import rules.
3. **TypeScript `lib`/`types`**: `domain` compiles without DOM or Node types, so browser and
   runtime APIs do not type-check there.

Approved matrix:

```text
web      → config, contracts, db, domain(content|events|organizations|newsletter|shared), email, observability, ui, auth
admin    → audit, auth, config, db, domain, email, observability, permissions, ui
shop     → auth, config, db, domain(shop|shared), email, observability, permissions, ui
gateway  → apikeys, config, contracts, db, domain, observability
auth     → config
db       → apikeys, config, domain
others   → (none)
```

Forbidden (fails lint): app → app, package → app, gateway → auth/permissions/audit/ui/email,
shop → non-shop domain, domain → React/Next/Hono/Vercel/Firebase/any workspace package,
domain/shop ↔ other domain modules, any Firebase import outside `packages/db/src/firestore/**`
and `packages/auth/src/firebase-admin.ts`, infrastructure (`@platform/db`, `@platform/email`,
Firebase admin adapter) from app code outside `src/server/**`.

Changing the matrix is an architecture decision: update the script, ESLint config and this file
in the same PR.

## Request flow (admin mutation)

```text
UI → Server Action → createGuardedAction:
       authenticate (session cookie → Firebase verify + revocation → staff record in DB)
       → validate (Zod) → authorize (permissions.can, scoped)
       → domain logic → repository (@platform/db) + audit event in the SAME transaction
```

## Asynchronous work

There is no job system by design. Side effects (email, Zoom) are synchronous with timeouts;
failures are recorded with a status and retried manually from admin. Scheduled publishing is a
read-time rule (`isPubliclyVisible`). Newsletter campaigns use Resend Broadcasts. If automatic
retries become necessary, add a **managed** HTTP queue at that time — not a self-hosted worker.
