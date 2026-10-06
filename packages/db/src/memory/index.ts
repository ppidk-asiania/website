import type { ApiKeyRecord } from "@platform/apikeys";
import type { PlatformEvent } from "@platform/domain/events";
import type { GatewayRepositories } from "../roles";

/**
 * In-memory repositories for local development and tests. Never used when
 * APP_ENV is staging or production (enforced by the app composition roots).
 */
export function createMemoryGatewayRepositories(
  seed: {
    events?: readonly PlatformEvent[];
    apiKeys?: readonly ApiKeyRecord[];
  } = {},
): GatewayRepositories {
  const events = [...(seed.events ?? [])];
  const apiKeys = new Map((seed.apiKeys ?? []).map((key) => [key.keyId, key]));
  return {
    events: {
      listPublished({ chapterId, updatedSince, cursor, limit }) {
        const filtered = events
          .filter((e) => e.published && e.deletedAt === null)
          .filter((e) => chapterId === undefined || e.chapterId === chapterId)
          .filter((e) => updatedSince === undefined || e.updatedAt > updatedSince)
          .sort((a, b) => a.id.localeCompare(b.id))
          .filter((e) => cursor === undefined || e.id > cursor);
        const items = filtered.slice(0, limit);
        const last = items.at(-1);
        return Promise.resolve({
          items,
          nextCursor: filtered.length > limit && last ? last.id : null,
        });
      },
      findById(id) {
        return Promise.resolve(events.find((e) => e.id === id) ?? null);
      },
    },
    apiKeys: {
      findByKeyId(keyId) {
        return Promise.resolve(apiKeys.get(keyId) ?? null);
      },
    },
  };
}
