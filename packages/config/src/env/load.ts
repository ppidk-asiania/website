import { type z } from "zod";
import type { AppEnvironment } from "../environments";

export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function loadEnv<
  S extends z.ZodObject<z.ZodRawShape & { APP_ENV: z.ZodType<AppEnvironment> }>,
>(schema: S, source: EnvSource): z.infer<S> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  return result.data;
}

export function lazyEnv<T>(load: () => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= load());
}
