import "server-only";
import {
  baseEnv,
  captchaEnv,
  firebaseAdminEnv,
  lazyEnv,
  loadEnv,
  sessionEnv,
} from "@website/config/env";

/** Public content, member self-service and CAPTCHA. Validated lazily at first use, not at build. */
const webEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(sessionEnv.shape)
  .extend(captchaEnv.partial().shape);

export const getWebEnv = lazyEnv(() => loadEnv(webEnvSchema, process.env));
