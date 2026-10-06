import type { ApiKeyRecord, ApiKeyStore, KeyEnvironment, RateLimiter } from "@platform/apikeys";
import type { EventReader } from "@platform/domain/events";
import type { Logger } from "@platform/observability";

/** Everything the gateway needs, injected. The gateway has NO access to admin/staff auth. */
export interface GatewayDeps {
  readonly logger: Logger;
  readonly apiKeys: ApiKeyStore;
  readonly events: EventReader;
  readonly rateLimiter: RateLimiter;
  readonly apiKeyPepper: string;
  readonly keyEnvironment: KeyEnvironment;
  readonly defaultRateLimitPerMinute: number;
  readonly now: () => Date;
}

export interface GatewayVariables {
  requestId: string;
  apiKey: ApiKeyRecord;
}
