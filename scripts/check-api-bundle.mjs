import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const entry = new URL("../apps/api/dist/vercel/index.js", import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(entry.href)}); console.log("API bundle import passed"); process.exit(0);`,
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      MONGODB_URI: "mongodb://127.0.0.1:27017/fl_bundle_smoke",
    },
    encoding: "utf8",
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || "API bundle import failed\n");
  process.exit(result.status ?? 1);
}
process.stdout.write(result.stdout);
