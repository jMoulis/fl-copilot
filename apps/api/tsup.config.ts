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
  noExternal: [
    "@fl-copilot/analytics-core",
    "@fl-copilot/commercial-core",
    "@fl-copilot/domain",
    "@fl-copilot/import-core",
    "@fl-copilot/sync-contracts",
    "@fl-copilot/substitution-core",
  ],
  clean: true,
  sourcemap: true,
});
