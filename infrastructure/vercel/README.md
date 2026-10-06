# Vercel projects

One Vercel project per deployable, all pointing at this repository:

| Vercel project     | Root directory | Domain              | Template              |
| ------------------ | -------------- | ------------------- | --------------------- |
| `platform-web`     | `apps/web`     | `web.example.org`   | `web.vercel.json`     |
| `platform-admin`   | `apps/admin`   | `admin.example.org` | `admin.vercel.json`   |
| `platform-shop`    | `apps/shop`    | `shop.example.org`  | `shop.vercel.json`    |
| `platform-gateway` | `apps/gateway` | `api.example.org`   | `gateway.vercel.json` |

Copy a template to `apps/<app>/vercel.json` when creating the project (kept here so the
apps stay deployment-agnostic until then). `turbo-ignore` skips a deployment when nothing
that app depends on changed, so a broken `shop` can never block a `web` hotfix.

Per project:

1. **Environment variables**: separate values for Preview, Staging (custom environment) and Production.
   Preview and Staging use the **staging** Firebase project. Production values exist only in Production.
2. Mark secrets as **Sensitive**.
3. Enable **Deployment Protection** for Preview deployments (preview URLs are otherwise public).
4. Set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in `package.json`.
5. Node.js version: 24.x.

See `docs/deployment.md`.
