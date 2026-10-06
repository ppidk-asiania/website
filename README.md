# ppidk-website

Production monorepo for the public website, admin, shop and external API gateway.

```text
apps/            independently deployed applications (one Vercel project each)
  web/           public website            → web.example.org     (port 3000)
  admin/         admin                     → admin.example.org   (port 3001)
  shop/          customer-facing shop      → shop.example.org    (port 3002)
  gateway/       third-party API (/v1)     → api.example.org     (port 3003)
packages/        shared, framework-independent where possible
infrastructure/  Firebase, Vercel, monitoring templates (nothing auto-provisioned)
docs/            architecture, security, environments, deployment, DR
tests/           unit · integration · e2e
scripts/         boundary check, secret scan, Windows doctor
```

## Quick start

```bash
corepack enable        # once; uses the pnpm version pinned in package.json
pnpm install
pnpm dev               # all four apps
pnpm verify            # format · lint+boundaries · typecheck · test · build · secret scan
```

Requirements: Node.js 24 LTS (≥ 22.12), Git. See [docs/development.md](docs/development.md).

## Key rules

- One repo, four deployables, no microservices, no queues/job workers.
- Admin data is written only by the server: authenticate → authorize → validate → domain → audit → DB.
- The gateway is the only public API and cannot import staff auth or admin internals.
- Staging (`ppidk-website-staging`) can never reach production (`ppidk-website-prod`) — `docs/environment.md`.
- Firestore for all data; one user pool for staff, members and customers; RBAC.
- Boundaries are enforced by `pnpm lint` (`docs/architecture.md`).

## Docs

[architecture](docs/architecture.md) · [development](docs/development.md) ·
[environment](docs/environment.md) · [deployment](docs/deployment.md) ·
[security](docs/security.md) · [database](docs/database.md) ·
[authentication](docs/authentication.md) · [authorization](docs/authorization.md) ·
[data model](docs/data-model.md) · [audit logging](docs/audit-logging.md) · [disaster recovery](docs/disaster-recovery.md)
