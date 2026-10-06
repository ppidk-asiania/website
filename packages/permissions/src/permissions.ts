/**
 * The complete permission vocabulary. Adding a permission is a reviewed code change.
 * Format: <resource>.<action>
 */
export const PERMISSIONS = [
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

export const ROLES = [
  "superadmin",
  "admin",
  "editor",
  "chapter_editor",
  "shop_manager",
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Role → permission map. Lives in code (versioned, reviewed), not in the database.
 * `superadmin` and `admin` are the high-level roles; the rest are granular.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  superadmin: PERMISSIONS,
  admin: PERMISSIONS.filter(
    (p) => p !== "users.manage" && p !== "apikeys.manage" && p !== "shop.refund",
  ),
  editor: [
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
    "content.read",
    "content.write",
    "news.read",
    "news.write",
    "events.read",
    "events.write",
    "gallery.read",
    "gallery.write",
  ],
  shop_manager: ["shop.products.write", "shop.orders.manage"],
  viewer: ["content.read", "news.read", "events.read", "gallery.read"],
};
