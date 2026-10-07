import "server-only";
import {
  baseEnv,
  captchaEnv,
  firebaseAdminEnv,
  lazyEnv,
  loadEnv,
  publicUrlsEnv,
  sessionEnv,
} from "@website/config/env";

/** Public content, member self-service, sign-in and CAPTCHA. Validated lazily at first use, not at build. */
const webEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(sessionEnv.shape)
  .extend(captchaEnv.partial().shape)
  .extend(publicUrlsEnv.pick({ WEB_URL: true }).shape);

export const getWebEnv = lazyEnv(() => loadEnv(webEnvSchema, process.env));
