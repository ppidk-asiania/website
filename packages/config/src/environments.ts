export const APP_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
