import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    runtime: "src/runtime.ts",
    "vercel/index": "src/vercel-handler.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  splitting: false,
  noExternal: ["@fl-copilot/domain", "@fl-copilot/sync-contracts"],
  clean: true,
  sourcemap: true,
});
