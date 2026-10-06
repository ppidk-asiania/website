/** Public API versions. A breaking change requires a new version, never an edit to v1 shapes. */
export const API_VERSIONS = ["v1"] as const;
export type ApiVersion = (typeof API_VERSIONS)[number];
export const CURRENT_API_VERSION: ApiVersion = "v1";
