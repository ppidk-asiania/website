import { createInMemoryRateLimiter } from "@website/apikeys";
import { baseEnv, gatewayEnv, loadEnv } from "@website/config/env";
import { createMemoryGatewayRepositories } from "@website/db/memory";
import { createLogger } from "@website/observability";
import type { GatewayDeps } from "./types";

const gatewayEnvSchema = baseEnv.extend(gatewayEnv.shape);

/**
 * Composition root. Development/test use in-memory adapters; staging/production refuse
 * to start until real adapters are wired (fail closed rather than serve fake data).
 */
export function createDepsFromEnv(
  source: Readonly<Record<string, string | undefined>>,
): GatewayDeps {
  const env = loadEnv(gatewayEnvSchema, source);
  if (env.APP_ENV === "staging" || env.APP_ENV === "production") {
    throw new Error(`Gateway persistence adapters are not wired yet for APP_ENV=${env.APP_ENV}.`);
  }
  const repos = createMemoryGatewayRepositories();
  return {
    logger: createLogger({ service: "gateway", level: env.LOG_LEVEL }),
    apiKeys: repos.apiKeys,
    events: repos.events,
    rateLimiter: createInMemoryRateLimiter(),
    apiKeyPepper: env.API_KEY_PEPPER,
    keyEnvironment: "test",
    defaultRateLimitPerMinute: env.GATEWAY_RATE_LIMIT_PER_MINUTE,
    now: () => new Date(),
  };
}
