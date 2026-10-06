# Vercel projects

One Vercel project per deployable, all pointing at this repository:

| Vercel project          | Root directory | Domain              | Template              |
| ----------------------- | -------------- | ------------------- | --------------------- |
| `ppidk-website-web`     | `apps/web`     | `web.example.org`   | `web.vercel.json`     |
| `ppidk-website-admin`   | `apps/admin`   | `admin.example.org` | `admin.vercel.json`   |
| `ppidk-website-shop`    | `apps/shop`    | `shop.example.org`  | `shop.vercel.json`    |
| `ppidk-website-gateway` | `apps/gateway` | `api.example.org`   | `gateway.vercel.json` |

Copy a template to `apps/<app>/vercel.json` when creating the project (kept here so the
apps stay deployment-agnostic until then). `turbo-ignore` skips a deployment when nothing
that app depends on changed, so a broken `shop` can never block a `web` hotfix.

Per project:

1. **Git**: Production Branch = `prod`. Create a custom environment **Staging** tracking the
   `staging` branch. Everything else (`dev`, PR branches) is a Preview.
2. **Environment variables**: separate values for Preview, Staging and Production.
   Preview and Staging use `ppidk-website-staging` (`APP_ENV=staging`); Production uses
   `ppidk-website-prod` (`APP_ENV=production`). Production values exist only in Production.
3. Mark secrets as **Sensitive**.
4. Enable **Deployment Protection** for Preview deployments (preview URLs are otherwise public).
5. Set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in `package.json`.
6. Node.js version: 24.x.

See `docs/deployment.md`.
