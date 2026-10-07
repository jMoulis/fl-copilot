import { NoObjectGeneratedError } from "ai";
import { classifyCommercialGenerationError } from "../src/commercial/ai-provider.js";
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

describe("commercial structured-output failures", () => {
  function failure(finishReason: "length" | "stop") {
    return new NoObjectGeneratedError({
      text: '{"blocks":[',
      response: { id: "unit", timestamp: new Date(0), modelId: "unit" },
      usage: {
        inputTokens: 1,
        inputTokenDetails: {
          noCacheTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 6000,
        outputTokenDetails: { textTokens: 6000, reasoningTokens: 0 },
        totalTokens: 6001,
      },
      finishReason,
    });
  }
  it("identifies truncation explicitly without treating partial JSON as a draft", () => {
    expect(classifyCommercialGenerationError(failure("length"))?.code).toBe(
      "COMMERCIAL_AI_OUTPUT_TOKEN_LIMIT",
    );
  });
  it("keeps actual invalid structured output distinct and does not turn network failures into schema failures", () => {
    expect(classifyCommercialGenerationError(failure("stop"))?.code).toBe(
      "COMMERCIAL_AI_OUTPUT_INVALID",
    );
    expect(
      classifyCommercialGenerationError(new Error("network unavailable")),
    ).toBeNull();
  });
});
