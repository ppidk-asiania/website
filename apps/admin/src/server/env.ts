import "server-only";
import {
  baseEnv,
  firebaseAdminEnv,
  lazyEnv,
  loadEnv,
  resendEnv,
  sessionEnv,
  zoomEnv,
} from "@website/config/env";

const adminEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(sessionEnv.shape)
  .extend(resendEnv.partial().shape)
  .extend(zoomEnv.partial().shape);

export const getAdminEnv = lazyEnv(() => loadEnv(adminEnvSchema, process.env));
