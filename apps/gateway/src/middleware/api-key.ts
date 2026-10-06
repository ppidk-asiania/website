import { createMiddleware } from "hono/factory";
import { hasScope, verifyApiKey, type ApiScope } from "@platform/apikeys";
import { problem } from "../http/problem";
import type { GatewayDeps, GatewayVariables } from "../types";

/** Authenticates the API key (Authorization: Bearer <key>) and applies its rate limit. */
export function requireApiKey(deps: GatewayDeps) {
  return createMiddleware<{ Variables: GatewayVariables }>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const raw = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const result = await verifyApiKey({
      raw,
      store: deps.apiKeys,
      pepper: deps.apiKeyPepper,
      expectedEnvironment: deps.keyEnvironment,
      now: deps.now(),
    });
    if (!result.ok) {
      deps.logger.info("api_key_rejected", {
        reason: result.reason,
        requestId: c.get("requestId"),
      });
      return problem(c, "unauthorized");
    }
    const limit = result.key.rateLimitPerMinute ?? deps.defaultRateLimitPerMinute;
    const rate = await deps.rateLimiter.consume(`key:${result.key.keyId}`, limit, deps.now());
    if (!rate.allowed) {
      c.header("Retry-After", String(rate.retryAfterSeconds));
      return problem(c, "rateLimited");
    }
    c.set("apiKey", result.key);
    return next();
  });
}

export function requireScope(scope: ApiScope) {
  return createMiddleware<{ Variables: GatewayVariables }>(async (c, next) => {
    if (!hasScope(c.get("apiKey"), scope)) return problem(c, "forbidden");
    return next();
  });
}
