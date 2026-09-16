import fs from "node:fs";
import path from "node:path";

const required = [
  "AGENTS.md",
  "apps/mobile",
  "apps/api",
  "packages/domain",
  "packages/sync-contracts",
  "packages/analytics-core",
  "packages/substitution-core",
  "packages/commercial-core",
  "packages/api-client",
  "packages/test-fixtures",
  "docs/specs/TECHNICAL_ARCHITECTURE_AND_IMPLEMENTATION_SPEC.md",
  "docs/specs/DATABASE_AND_API_CONTRACTS.md",
  "docs/specs/UX_FLOWS_AND_SCREEN_SPEC.md",
  "docs/specs/IMPLEMENTATION_PLAN.md",
];

const missing = required.filter((entry) => !fs.existsSync(path.resolve(entry)));

if (missing.length) {
  console.error("M0-T01 structure verification failed.");
  console.error("Missing:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log("M0-T01 structure verification passed.");
