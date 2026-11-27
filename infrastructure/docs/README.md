# Infrastructure docs

Infrastructure is described here and provisioned manually (or with Terraform later) — never
automatically by this repository. Start with:

- `../../docs/deployment.md` — deployment boundaries, environments, rollback
- `../../docs/environment.md` — environments and variables
- `../../docs/disaster-recovery.md` — backups and restore drills
- `../monitoring/README.md`

## Provisioning checklist (one-time)

- [ ] Google Cloud project (owned by ≥2 people with 2-step verification) with one OAuth web client for Sign in with Google; every `WEB_URL` in its Authorized JavaScript origins (`../../docs/deployment.md` → One-time setup)
- [ ] `SESSION_SECRET` (≥ 32 characters), the same in web, admin and shop, kept only in the cPanel **Setup Node.js App** screens and the password manager
- [ ] The old Firebase project: delete it (or at least its service-account keys) once nobody needs its accounts list
- [ ] cPanel MySQL: one database, one MySQL user per app (`../../docs/deployment.md` → One-time setup)
- [ ] Files folder `FILE_STORAGE_DIR` outside the app folders; nightly dump + files backup and a weekly off-server copy (`../../docs/disaster-recovery.md`)
- [ ] DomaiNesia cPanel: four Node.js apps, domains + AutoSSL, env vars per app, Cron Jobs (`../../docs/deployment.md`)
- [ ] Resend: verified sending subdomains, SPF/DKIM/DMARC
- [ ] Budget alerts on GCP
