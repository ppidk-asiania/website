# Authorization

## Model: RBAC with scope

- **Permissions** (`packages/permissions/src/permissions.ts`): `<resource>.<action>`, e.g.
  `events.write`, `news.publish`, `users.manage`, `shop.refund`, `audit.revert`.
- **Roles** → permissions map in code (reviewed in PRs): `superadmin`, `admin`, `editor`,
  `chapter_editor`, `shop_manager`, `viewer`. `admin`/`superadmin` are the high-level roles; the
  rest are granular.
- **Assignments** (database): `(staffId, role, scope)` where scope is `global` or
  `{ chapter: id }`.

```ts
can(principal, "events.write", { chapterId: "jp" }); // boolean, deny by default
requirePermission(principal, "news.publish"); // throws Unauthenticated/Forbidden
canAssignRole(principal, "editor"); // anti-escalation
```

## Rules

- Evaluated **server-side only**. Never trust hidden buttons, client route guards, client
  state, a Firebase login alone, URL params, or role fields in payloads (tested).
- UI may _hide_ things for UX by calling server-provided capability flags, but the server check
  is the only one that counts. No authorization logic inside UI components.
- Every admin mutation uses `createGuardedAction({ permission, input, resource?, handler })`.
- Third-party scopes (`events.read`, `registrations.write`) are a separate vocabulary in
  `@platform/apikeys`.
- Superadmins: keep 2–3; the last one cannot be demoted; role changes emit security events.
