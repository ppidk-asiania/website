# Security

## Baseline (verified by tooling)

| Control                                | Enforcement                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No secrets in git                      | `.gitignore` + `pnpm check:secrets` (CI); enable GitHub push protection too                                                                                               |
| `.env.example` placeholders only       | `check:secrets`                                                                                                                                                           |
| Staging cannot reach production        | `assertEnvironmentIsolation` + separate projects/IAM (`environment.md`)                                                                                                   |
| No browser access to Firestore/Storage | Deny-all `firestore.rules` / `storage.rules`; lint bans `firebase/firestore` etc. in apps                                                                                 |
| Admin SDK never in browser code        | Firebase imports allowed only in two server adapters; adapters throw if bundled for the browser; app code reaches them only from `src/server/**` (`import "server-only"`) |
| Server-side authN/Z for admin          | `getPrincipal()` per request + `createGuardedAction` (tests: `admin-guarded-action.test.ts`)                                                                              |
| Gateway isolated from staff auth       | Lint + boundary check (gateway cannot import `@platform/auth`, `permissions`, `audit`, `ui`)                                                                              |
| Health endpoints leak nothing          | `{ "status": "ok" }` only (tests)                                                                                                                                         |
| Security headers                       | `next.config.ts` per app; `secureHeaders()` in gateway                                                                                                                    |
| Install scripts                        | Denied by default; explicit `allowBuilds` in `pnpm-workspace.yaml`                                                                                                        |
| Fresh-release hijacks                  | `minimumReleaseAge: 1440` (24 h)                                                                                                                                          |

## Threat model summary

| Threat                     | Mitigation                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Account takeover (staff)   | Google sign-in, MFA, short `__Host-` session cookies, `verifySessionCookie(…, checkRevoked)`, re-auth for sensitive actions |
| Authorization bypass       | Never rely on `proxy.ts`/middleware for authZ; every action re-checks; deny by default                                      |
| Privilege escalation       | `canAssignRole`: only `users.manage`, and never a role with permissions you lack                                            |
| Stolen tokens              | HttpOnly cookies per subdomain, revocation, fresh-sign-in requirement on session creation                                   |
| Service account compromise | Per-role service accounts, WIF instead of keys, backups in a separate project                                               |
| Malicious uploads          | Signed uploads, magic-byte checks, size/pixel limits, re-encode, reject SVG (next phase)                                    |
| XSS                        | Sanitize rich text on write and render; nonce CSP via `proxy.ts` (next phase)                                               |
| CSRF                       | Server Actions check Origin; cookie-auth route handlers check Origin + SameSite                                             |
| SSRF                       | No server-side fetch of user URLs without an allowlist/IP check                                                             |
| Rate limiting / bots       | Gateway per-key limits; public forms: rate limit + reCAPTCHA v3 + double opt-in                                             |
| Replay / duplicate writes  | `Idempotency-Key` required on gateway writes; webhook event-ID dedupe                                                       |
| Webhook forgery            | Signature + timestamp verification, dedupe, re-fetch state from provider                                                    |
| Audit tampering            | No mutation API; append-only store permissions; hash chain; off-project export                                              |
| API key leakage            | Only HMAC(secret, pepper) stored; shown once; per-key scopes/expiry/revocation; env-specific prefixes                       |

## Reporting

Security issues: contact the platform maintainers privately; do not open public issues.
