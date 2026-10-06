import type { ApiKeyStore } from "@platform/apikeys";
import type { ContentReader, ContentWriter } from "@platform/domain/content";
import type { EventReader } from "@platform/domain/events";
import type { ChapterReader } from "@platform/domain/organizations";

/**
 * Each deployable gets ONE role and only the repositories that role may use.
 * The type system stops `web` from ever obtaining a writer.
 *
 * With Firestore, roles map to separate service accounts with distinct IAM grants
 * (see docs/database.md). With PostgreSQL they map to real database roles.
 */
export type DatabaseRole = "web_ro" | "admin_rw" | "shop_rw" | "gateway_rw";

export interface WebRepositories {
  readonly content: ContentReader;
  readonly events: EventReader;
  readonly chapters: ChapterReader;
}

export interface AdminRepositories {
  readonly content: ContentWriter;
  readonly events: EventReader;
  readonly chapters: ChapterReader;
}

export interface GatewayRepositories {
  readonly events: EventReader;
  readonly apiKeys: ApiKeyStore;
}

/** Shop repositories are added when the shop data model is decided (Firestore vs PostgreSQL). */
export type ShopRepositories = Readonly<Record<never, never>>;

export interface RepositoriesByRole {
  web_ro: WebRepositories;
  admin_rw: AdminRepositories;
  shop_rw: ShopRepositories;
  gateway_rw: GatewayRepositories;
}
