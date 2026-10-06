/**
 * Vercel entry point (Hono is detected zero-config). Env is validated at cold start;
 * a misconfigured deployment fails immediately instead of serving traffic.
 */
import { createGatewayApp } from "./app";
import { createDepsFromEnv } from "./deps";

const app = createGatewayApp(createDepsFromEnv(process.env));
export default app;
