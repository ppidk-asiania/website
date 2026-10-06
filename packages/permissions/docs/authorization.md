# Authorization (RBAC)

## Model

- **Permissions** (`packages/permissions/src/permissions.ts`): `<resource>.<action>`.
  `*_own` permissions apply only to resources the user owns (`ownerId === userId`).
- **Roles** → permissions map in code (reviewed in PRs).
- **Assignments** in `users/{uid}.roleAssignments`: `{ role, scope }`, scope `global` or `{ chapter }`.

| Role             | Who                     | Key permissions                                                                              |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `user`           | every account (default) | `profile.*_own`, `events.register`, `registrations.read_own`, `shop.orders.read_own`         |
| `member`         | approved PPI member     | same self-service (member-only features later)                                               |
| `viewer`         | staff                   | `admin.access`, read content/news/events/gallery                                             |
| `chapter_editor` | staff, chapter-scoped   | write content/news/events/gallery in their chapter                                           |
| `editor`         | staff                   | + `news.publish`, `newsletter.write`                                                         |
| `chapter_admin`  | staff, chapter-scoped   | + `members.read`, `members.read_pii`, `members.approve`, `registrants.read` in their chapter |
| `shop_manager`   | staff                   | `shop.products.write`, `shop.orders.manage`                                                  |
| `admin`          | staff                   | everything except `users.manage`, `apikeys.manage`, `shop.refund`, `members.export`          |
| `superadmin`     | 2–3 people              | everything                                                                                   |

```ts
can(principal, "events.write", { chapterId: "jp" });
can(principal, "profile.write_own", { ownerId: principal.userId });
canAccessAdmin(principal); // any staff role
requirePermission(principal, "news.publish");
canAssignRole(principal, "editor"); // anti-escalation
```

## Rules

- Evaluated **server-side only**. Never trust hidden buttons, client route guards, client
  state, a Firebase login alone, URL params, or role fields in payloads (tested).
- Every admin mutation uses `createGuardedAction` (staff role → validation → permission).
- Third-party API scopes (`events.read`, `registrations.write`) are a separate vocabulary in
  `@website/apikeys`.
- Keep 2–3 superadmins; the last one cannot be demoted; role changes emit security events.
