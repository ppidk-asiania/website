import "server-only";
import {
  baseEnv,
  databaseEnv,
  lazyEnv,
  loadEnv,
  paymentEnv,
  resendEnv,
  sessionEnv,
} from "@website/config/env";

const storeEnvSchema = baseEnv
  .extend(databaseEnv.shape)
  .extend(sessionEnv.shape)
  .extend(paymentEnv.partial().shape)
  .extend(resendEnv.partial().shape);

export const getStoreEnv = lazyEnv(() => loadEnv(storeEnvSchema, process.env));
