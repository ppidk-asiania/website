# Audit logging

## Record

`packages/audit/src/types.ts → AuditEvent`: `actor`, `action`, `resourceType`, `resourceId`,
`occurredAt`, `operationId`, `before`, `after`, `versionBefore/After`, `revertible`, `revertOf`,
request metadata (`requestId`, hashed IP, user agent), and `prevHash`/`hash` for a tamper-evident chain.

## Guarantees

- **Append-only**: the package has no update/delete API (tested). The writer port only `append`s.
  The store must refuse updates/deletes for application credentials.
- **Same transaction**: the entity write and its audit event commit together.
- **Revert** (`evaluateRevert`, `buildRevertEvent`):
  - only within **14 days**, only by holders of `audit.revert`, server-side;
  - only if the entity's current version equals the event's `versionAfter` (no silent overwrite
    of later edits → `version_conflict`);
  - never twice, never a revert of a revert, never for non-revertible side effects (emails sent,
    payments);
  - produces a **new** audit event (`revertOf`), the original is untouched.
- **Deleted records** are soft-deleted; revert = undelete. Media must be retained ≥ 14 days.
- **Grouped operations** share `operationId` and are reverted as a unit.
- **Diffs** (`diffSnapshots`) are for display; full snapshots are the source of truth.
- **Personal data**: minimize registrant PII in snapshots; never snapshot secrets.

## Integrity (implementation phase)

Hash chain verified nightly; daily export to a retention-locked bucket in a separate project.
