import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node",
    // Fresh integration databases apply the complete migration history before tests run.
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
