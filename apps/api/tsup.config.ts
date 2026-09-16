import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: ["@fl-copilot/sync-contracts"],
  clean: true,
  sourcemap: true,
});
