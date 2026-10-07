import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_AI_TIMEOUT_MS,
  COMMERCIAL_AI_PAGE_LEASE_MS,
} from "../src/commercial/ai-runtime-limits.js";
describe("commercial AI execution budgets", () => {
  it("allows model completion before the function ends and prevents lease expiry while that callback can still write", () => {
    const config = JSON.parse(
      readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
    );
    const serverDuration = config.functions["api/index.ts"].maxDuration * 1000;
    expect(COMMERCIAL_AI_TIMEOUT_MS).toBeGreaterThan(45_000);
    expect(serverDuration).toBeGreaterThan(COMMERCIAL_AI_TIMEOUT_MS + 10_000);
    expect(COMMERCIAL_AI_PAGE_LEASE_MS).toBeGreaterThan(serverDuration);
  });
});
