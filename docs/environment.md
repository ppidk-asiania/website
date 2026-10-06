# Environments

| `APP_ENV`     | Where                                  | Firebase project                    | Data           |
| ------------- | -------------------------------------- | ----------------------------------- | -------------- |
| `development` | Your machine                           | Emulators (`demo-*`) or **staging** | Fake / staging |
| `test`        | CI, Playwright                         | None (in-memory adapters)           | Fake           |
| `staging`     | `dev`/`staging` branches + PR previews | `ppidk-website-staging`             | Staging only   |
| `production`  | `prod` branch (Vercel Production)      | `ppidk-website-prod`                | Real           |

`APP_ENV` is ours; `NODE_ENV` is "production" for every optimized build and must not be used
to tell staging from production.

## The staging ↔ production boundary

Enforced in code (`packages/config/src/environments.ts → assertEnvironmentIsolation`), and
called by every env loader and every Firebase adapter:

- Any `APP_ENV` other than `production` **throws** if pointed at a production project ID.
- `production` **throws** unless its project ID is in `PRODUCTION_FIREBASE_PROJECT_IDS`.
- Emulator hosts are rejected in staging/production.

Enforced by configuration:

- Separate Firebase/GCP projects with separate service accounts. Staging credentials have **no
  IAM grants** in the production project, so even a misconfiguration cannot write there.
- Vercel: production secrets exist only in the Production environment. Preview and Staging use
  staging values. Audit this when adding a variable.
- CI never receives staging or production secrets.

When the real project IDs are created, update **both** `packages/config/src/environments.ts`
and `infrastructure/firebase/.firebaserc` (tests cover the guard).

## Variables

Each app validates only the fragments it needs (`packages/config/src/env/schemas.ts`), lazily at
first use — never at import or build time — and errors list variable names, never values.

| File                        | Variables                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/.env.example`     | APP_ENV, LOG_LEVEL, FIREBASE_* (read-only SA), RECAPTCHA_*                                                                       |
| `apps/admin/.env.example`   | APP_ENV, FIREBASE__, NEXT_PUBLIC_FIREBASE__, SESSION_MAX_AGE_HOURS, RESEND__, EMAIL_FROM__, ZOOM_*, CALENDAR_FEED_SIGNING_SECRET |
| `apps/shop/.env.example`    | APP_ENV, FIREBASE__, NEXT_PUBLIC_FIREBASE__, PAYMENT__, RESEND__                                                                 |
| `apps/gateway/.env.example` | APP_ENV, PORT, API_KEY_PEPPER, GATEWAY__, FIREBASE__                                                                             |

`.env.example` files must contain placeholders only; `pnpm check:secrets` fails otherwise.
