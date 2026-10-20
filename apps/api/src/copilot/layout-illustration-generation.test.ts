import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createLayoutIllustrationGeneration } from "./layout-illustration-generation";
import { parseEnvironment } from "../config";
import { illustrationGenerationFixture } from "../../../../scripts/test-layout-illustration-generation";
it("keeps generation disabled by default without looking up data, reserving attempts or calling a provider", async () => {
  const db = {
      getDb: vi.fn(),
      close: async () => {},
      checkHealth: async () => "connected" as const,
    },
    provider = { generate: vi.fn() },
    files = { persist: vi.fn(), recover: vi.fn() };
  const service = createLayoutIllustrationGeneration(
    db,
    { enabled: false },
    files,
    provider,
  );
  expect(
    await service.quote(
      { storeId: randomUUID(), userId: randomUUID() },
      randomUUID(),
    ),
  ).toEqual({ state: "DISABLED" });
  expect(db.getDb).not.toHaveBeenCalled();
  expect(provider.generate).not.toHaveBeenCalled();
  expect(files.persist).not.toHaveBeenCalled();
  expect(
    parseEnvironment({ NODE_ENV: "test" })
      .LAYOUT_ILLUSTRATION_GENERATION_ENABLED,
  ).toBe(false);
});
it("requires an explicit validated model/estimate policy, provider and secret before activation, without logging supplied values", async () => {
  const f = await illustrationGenerationFixture();
  try {
    const database = {
      getDb: vi.fn(),
      close: async () => {},
      checkHealth: async () => "connected" as const,
    };
    expect(() =>
      createLayoutIllustrationGeneration(
        database,
        { enabled: true, policy: f.policy },
        { persist: vi.fn(), recover: vi.fn() },
      ),
    ).toThrow("NOT_CONFIGURED");
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        LAYOUT_ILLUSTRATION_GENERATION_ENABLED: "true",
        LAYOUT_ILLUSTRATION_GENERATION_POLICY: "PRIVATE_SENTINEL",
      }),
    ).toThrow("Invalid environment: LAYOUT_ILLUSTRATION_GENERATION_POLICY");
    try {
      parseEnvironment({
        NODE_ENV: "test",
        LAYOUT_ILLUSTRATION_GENERATION_ENABLED: "true",
        LAYOUT_ILLUSTRATION_GENERATION_POLICY: "PRIVATE_SENTINEL",
      });
    } catch (e) {
      expect(String(e)).not.toContain("PRIVATE_SENTINEL");
    }
  } finally {
    f.db.close();
  }
});
