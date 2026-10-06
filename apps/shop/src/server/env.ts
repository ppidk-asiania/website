import "server-only";
import {
  baseEnv,
  firebaseAdminEnv,
  lazyEnv,
  loadEnv,
  paymentEnv,
  resendEnv,
} from "@website/config/env";

const shopEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(paymentEnv.partial().shape)
  .extend(resendEnv.partial().shape);

export const getShopEnv = lazyEnv(() => loadEnv(shopEnvSchema, process.env));
