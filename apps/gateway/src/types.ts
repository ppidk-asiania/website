import type { ApiKeyRecord, ApiKeyStore, KeyEnvironment } from "@website/apikeys";
import type { EventReader } from "@website/domain/events";
import type { Logger } from "@website/observability";
import type { RateLimitStore } from "@website/security";

/** Everything the gateway needs, injected. The gateway has NO access to admin/staff auth. */
export interface GatewayDeps {
  readonly logger: Logger;
  readonly apiKeys: ApiKeyStore;
  readonly events: EventReader;
  readonly rateLimitStore: RateLimitStore;
  /** HMAC key for per-IP counters. */
  readonly rateLimitSecret: string;
  readonly apiKeyPepper: string;
  readonly keyEnvironment: KeyEnvironment;
  readonly defaultRateLimitPerMinute: number;
  readonly now: () => Date;
}

export interface GatewayVariables {
  requestId: string;
  apiKey: ApiKeyRecord;
}
