# Monitoring (templates)

To be provisioned in the observability phase. Planned checks:

| Check               | Target                                             | Alert                                                                            |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Uptime              | `https://web.example.org/`                         | 2 consecutive failures                                                           |
| Uptime              | `https://admin.example.org/` (login page)          | 2 consecutive failures                                                           |
| Uptime              | `https://shop.example.org/`                        | 2 consecutive failures                                                           |
| Uptime              | `https://api.example.org/health`                   | 2 consecutive failures                                                           |
| Error rate          | Sentry, per app                                    | new issue / spike                                                                |
| Security events     | log stream `security_event`                        | any `staff.role_changed`, `apikey.created`, `audit.revert`, login-failure spikes |
| Email               | bounce rate > 2%, complaint rate > 0.1%            |                                                                                  |
| Failed side effects | `email_log` / `zoom_requests` with status `failed` | any, daily digest                                                                |
| Cost                | GCP + Vercel budget alerts                         | 50% / 90% (never auto-disable billing)                                           |

`checks.example.json` is a vendor-neutral list for whichever uptime tool is chosen.
