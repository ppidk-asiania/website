import "server-only";
import { baseEnv, firebaseAdminEnv, captchaEnv, lazyEnv, loadEnv } from "@platform/config/env";

/** Web only needs read access + CAPTCHA verification. Validated lazily at first use, not at build. */
const webEnvSchema = baseEnv.extend(firebaseAdminEnv.shape).extend(captchaEnv.partial().shape);

export const getWebEnv = lazyEnv(() => loadEnv(webEnvSchema, process.env));
