/**
 * Deployment environments and the hard boundary between them.
 *
 * `APP_ENV` is our own variable. Do not use NODE_ENV for this: NODE_ENV is
 * "production" for every optimized build, including staging.
 */
export const APP_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * Firebase/GCP project IDs that are PRODUCTION. Only APP_ENV=production may use them.
 * Keep in sync with infrastructure/firebase/.firebaserc. Placeholder until projects exist.
 */
export const PRODUCTION_FIREBASE_PROJECT_IDS: readonly string[] = ["ppidk-platform-prod"];

/** Staging project IDs. Production must never point at these either. */
export const STAGING_FIREBASE_PROJECT_IDS: readonly string[] = ["ppidk-platform-staging"];

export class EnvironmentIsolationError extends Error {
  override readonly name = "EnvironmentIsolationError";
}

/**
 * Throws if the configured project crosses an environment boundary.
 * Called by every env loader that has a Firebase project ID.
 */
export function assertEnvironmentIsolation(input: {
  appEnv: AppEnvironment;
  firebaseProjectId: string | undefined;
  emulatorHost: string | undefined;
}): void {
  const { appEnv, firebaseProjectId, emulatorHost } = input;
  const isProdProject =
    firebaseProjectId !== undefined && PRODUCTION_FIREBASE_PROJECT_IDS.includes(firebaseProjectId);
  const isStagingProject =
    firebaseProjectId !== undefined && STAGING_FIREBASE_PROJECT_IDS.includes(firebaseProjectId);

  if (appEnv !== "production" && isProdProject) {
    throw new EnvironmentIsolationError(
      `APP_ENV=${appEnv} must never use a production Firebase project (${firebaseProjectId}).`,
    );
  }
  if (appEnv === "production" && !isProdProject) {
    throw new EnvironmentIsolationError(
      "APP_ENV=production requires a Firebase project listed in PRODUCTION_FIREBASE_PROJECT_IDS.",
    );
  }
  if (appEnv === "production" && isStagingProject) {
    throw new EnvironmentIsolationError("Production must never use a staging Firebase project.");
  }
  if ((appEnv === "staging" || appEnv === "production") && emulatorHost) {
    throw new EnvironmentIsolationError(
      `Firebase emulators are only allowed in development/test (APP_ENV=${appEnv}).`,
    );
  }
}
