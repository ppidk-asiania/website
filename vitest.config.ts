import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const serverOnlyStub = fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { "server-only": serverOnlyStub } },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias: { "server-only": serverOnlyStub } },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
