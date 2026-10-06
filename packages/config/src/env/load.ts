import { type z } from "zod";
import { assertEnvironmentIsolation, type AppEnvironment } from "../environments";

export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";
  constructor(readonly issues: readonly string[]) {
    // Only variable names and messages — never values.
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Validates `source` against `schema`. Empty strings are treated as unset so
 * that blank lines copied from .env.example fail loudly instead of passing.
 * Runs the environment-isolation guard whenever a Firebase project is configured.
 */
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

  const env = result.data as Record<string, unknown>;
  const appEnv = env["APP_ENV"] as AppEnvironment;
  const projectId = (env["FIREBASE_PROJECT_ID"] ?? env["NEXT_PUBLIC_FIREBASE_PROJECT_ID"]) as
    string | undefined;
  const emulatorHost = (env["FIREBASE_AUTH_EMULATOR_HOST"] ?? env["FIRESTORE_EMULATOR_HOST"]) as
    string | undefined;
  if (projectId !== undefined || emulatorHost !== undefined) {
    assertEnvironmentIsolation({ appEnv, firebaseProjectId: projectId, emulatorHost });
  }

  return result.data;
}

/** Memoizes an env loader so validation runs once per process, lazily (never at import/build time). */
export function lazyEnv<T>(load: () => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= load());
}
