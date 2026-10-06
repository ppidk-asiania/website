import { createMiddleware } from "hono/factory";
import { resolveRequestId } from "@website/observability";
import type { GatewayVariables } from "../types";

export const requestId = createMiddleware<{ Variables: GatewayVariables }>(async (c, next) => {
  const id = resolveRequestId(c.req.header("x-request-id"));
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
});
