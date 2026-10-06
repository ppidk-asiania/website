import { describe, expect, it } from "vitest";
import { EnvironmentIsolationError } from "@website/config";
import { baseEnv, EnvValidationError, firebaseAdminEnv, loadEnv } from "@website/config/env";

const schema = baseEnv.extend(firebaseAdminEnv.shape);

describe("environment validation", () => {
  it("rejects missing and blank required variables without echoing values", () => {
    expect(() => loadEnv(schema, { APP_ENV: "development", FIREBASE_PROJECT_ID: "  " })).toThrow(
      EnvValidationError,
    );
  });

  it("never lets staging/development use the production Firebase project", () => {
    for (const appEnv of ["development", "test", "staging"]) {
      expect(() =>
        loadEnv(schema, { APP_ENV: appEnv, FIREBASE_PROJECT_ID: "ppidk-website-prod" }),
      ).toThrow(EnvironmentIsolationError);
    }
  });

  it("requires production to use a registered production project and no emulators", () => {
    expect(() =>
      loadEnv(schema, { APP_ENV: "production", FIREBASE_PROJECT_ID: "ppidk-website-staging" }),
    ).toThrow(EnvironmentIsolationError);
    expect(() =>
      loadEnv(schema, {
        APP_ENV: "production",
        FIREBASE_PROJECT_ID: "ppidk-website-prod",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
      }),
    ).toThrow(EnvironmentIsolationError);
    expect(
      loadEnv(schema, { APP_ENV: "production", FIREBASE_PROJECT_ID: "ppidk-website-prod" }).APP_ENV,
    ).toBe("production");
  });

  it("accepts staging with the staging project", () => {
    expect(
      loadEnv(schema, { APP_ENV: "staging", FIREBASE_PROJECT_ID: "ppidk-website-staging" })
        .FIREBASE_PROJECT_ID,
    ).toBe("ppidk-website-staging");
  });
});
