# Deployment

## Boundaries

Four Vercel projects from one repository (see `infrastructure/vercel/README.md`). Each has its
own domain, environment variables, service account and rollback. `turbo-ignore` skips builds for
apps whose dependency graph did not change.

## Flow

```text
feature branch → PR → CI (format, lint+boundaries, typecheck, test, build, secrets, e2e)
               → Vercel Preview (staging Firebase, deployment protection on)
               → review → merge to main
               → Staging (automatic) → smoke checks → promote to Production
```

- Trunk-based, short-lived branches; `main` is protected (required CI, ≥1 review, no force push).
- Production is promoted, not rebuilt, so what was tested is what ships.

## Rollback

- **Code**: Vercel instant rollback per app.
- **Data**: changes are expand/contract — add new fields/collections first, ship code that handles
  both shapes, remove the old shape in a later release. Never ship a destructive data change in
  the same deploy as the code that needs it. Take a backup/PITR note before every migration.

## Migrations

Firestore has no schema migrations: use versioned scripts (`infrastructure/` in a later phase)
plus a `schemaVersion` field and tolerant readers. If the shop moves to PostgreSQL, its
migrations run in CI before deploy.

## Feature flags

Start with a server-side flags module/config document. Adopt a flag service only when
percentage rollouts are needed.

## Secrets

Vercel environment variables (Sensitive), separate per environment. Prefer Vercel OIDC →
GCP Workload Identity Federation over JSON keys. Rotate on schedule and when anyone leaves.
