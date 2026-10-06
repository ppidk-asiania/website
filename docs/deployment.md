# Deployment

## Boundaries

Four Vercel projects from one repository (see `infrastructure/vercel/README.md`). Each has its
own domain, environment variables, service account and rollback. `turbo-ignore` skips builds for
apps whose dependency graph did not change.

## Branches and flow

| Branch                          | Purpose                                           | Deploys to                          | Firebase project        |
| ------------------------------- | ------------------------------------------------- | ----------------------------------- | ----------------------- |
| `feature/*`, `fix/*`, `chore/*` | One change each, short-lived, branched from `dev` | Vercel Preview                      | `ppidk-website-staging` |
| `dev`                           | Integration of finished work                      | Vercel Preview (dev branch)         | `ppidk-website-staging` |
| `staging`                       | Release candidate, tested by the team             | Vercel Staging (custom environment) | `ppidk-website-staging` |
| `prod`                          | What is live (default branch)                     | Vercel Production                   | `ppidk-website-prod`    |

```text
feature/* ─PR─▶ dev ─PR─▶ staging ─PR─▶ prod
              CI on every PR and push: format, lint+boundaries, typecheck, test, build, secrets, e2e
```

- Changes only move forward by pull request: `feature → dev → staging → prod`. Never commit
  directly to `dev`, `staging` or `prod`, and never merge `dev` straight into `prod`.
- Hotfix: branch from `prod`, PR into `prod`, then merge `prod` back into `staging` and `dev`.
- Protect `dev`, `staging` and `prod` on GitHub: require a PR, require the **CI** check, block
  force pushes and deletion. `prod` additionally requires ≥ 1 approving review.
- Dependabot PRs target `dev`.

## Rollback

- **Code**: Vercel instant rollback per app.
- **Data**: changes are expand/contract — add new fields/collections first, ship code that handles
  both shapes, remove the old shape in a later release. Never ship a destructive data change in
  the same deploy as the code that needs it. Take a backup/PITR note before every migration.

## Migrations

Firestore has no schema migrations: use versioned scripts (`infrastructure/` in a later phase)
plus a `schemaVersion` field and tolerant readers.

## Feature flags

Start with a server-side flags module/config document. Adopt a flag service only when
percentage rollouts are needed.

## Secrets

Vercel environment variables (Sensitive), separate per environment. Prefer Vercel OIDC →
GCP Workload Identity Federation over JSON keys. Rotate on schedule and when anyone leaves.
