/**
 * The complete permission vocabulary. Adding a permission is a reviewed code change.
 * Format: <resource>.<action>. Permissions ending in `_own` only apply to resources
 * owned by the acting user (see policy.ts).
 */
export const PERMISSIONS = [
  // Self-service (every signed-in user)
  "profile.read_own",
  "profile.write_own",
  "events.register",
  "registrations.read_own",
  "shop.orders.read_own",
  // Admin area
  "admin.access",
  "content.read",
  "content.write",
  "news.read",
  "news.write",
  "news.publish",
  "events.read",
  "events.write",
  "registrants.read",
  "registrants.export",
  "gallery.read",
  "gallery.write",
  "newsletter.write",
  "newsletter.send",
  "organizations.write",
  "members.read",
  "members.read_pii",
  "members.export",
  "members.approve",
  "users.manage",
  "audit.read",
  "audit.revert",
  "apikeys.manage",
  "tools.zoom",
  "shop.products.write",
  "shop.orders.manage",
  "shop.refund",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * One account system for everyone (staff, members, customers). What an account may do
 * comes only from its role assignments:
 *
 * - `user`: every signed-in account (assigned automatically on first sign-in)
 * - `member`: an approved PPI member
 * - staff roles: `viewer` … `superadmin`; every staff role includes `admin.access`
 */
export const ROLES = [
  "superadmin",
  "admin",
  "chapter_admin",
  "editor",
  "chapter_editor",
  "shop_manager",
  "viewer",
  "member",
  "user",
] as const;
export type Role = (typeof ROLES)[number];

const SELF_SERVICE: readonly Permission[] = [
  "profile.read_own",
  "profile.write_own",
  "events.register",
  "registrations.read_own",
  "shop.orders.read_own",
];

const STAFF_HIGH_RISK: readonly Permission[] = [
  "users.manage",
  "apikeys.manage",
  "shop.refund",
  "members.export",
];

/**
 * Role → permission map. Lives in code (versioned, reviewed), not in the database.
 * Scoped roles (chapter_*) only take effect for resources in their chapter.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  superadmin: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => !STAFF_HIGH_RISK.includes(p)),
  chapter_admin: [
    ...SELF_SERVICE,
    "admin.access",
    "content.read",
    "content.write",
    "news.read",
    "news.write",
    "events.read",
    "events.write",
    "registrants.read",
    "gallery.read",
    "gallery.write",
    "members.read",
    "members.read_pii",
    "members.approve",
  ],
  editor: [
    ...SELF_SERVICE,
    "admin.access",
    "content.read",
    "content.write",
    "news.read",
    "news.write",
    "news.publish",
    "events.read",
    "events.write",
    "gallery.read",
    "gallery.write",
    "newsletter.write",
  ],
  chapter_editor: [
    ...SELF_SERVICE,
    "admin.access",
    "content.read",
    "content.write",
    "news.read",
    "news.write",
    "events.read",
    "events.write",
    "gallery.read",
    "gallery.write",
  ],
  shop_manager: [...SELF_SERVICE, "admin.access", "shop.products.write", "shop.orders.manage"],
  viewer: [
    ...SELF_SERVICE,
    "admin.access",
    "content.read",
    "news.read",
    "events.read",
    "gallery.read",
  ],
  member: [...SELF_SERVICE],
  user: [...SELF_SERVICE],
};
