import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createCommercialInngestWorkflows } from "../commercial/inngest-workflows";
const database = {
  getDb: vi.fn(),
  close: async () => {},
  checkHealth: async () => "connected" as const,
};
it("dispatches only stable generation identity and version using the existing durable client", async () => {
  const id = randomUUID(),
    storeId = randomUUID(),
    process = vi.fn(),
    pending = vi.fn(async () => [{ id, version: 3 }]);
  const workflow = createCommercialInngestWorkflows(
      database,
      "test-event-key",
      "signkey-test-only",
      undefined,
      undefined,
      undefined,
      { process, pending },
    ),
    send = vi
      .spyOn(workflow.client, "send")
      .mockResolvedValue({ ids: ["event"] });
  expect(await workflow.dispatchIllustrations(storeId)).toBe(1);
  expect(send).toHaveBeenCalledWith([
    {
      id: `layout-illustration.v1:${id}:3`,
      name: "copilot/layout-illustration.generate",
      data: { id },
    },
  ]);
  expect(pending).toHaveBeenCalledWith(storeId);
  expect(process).not.toHaveBeenCalled();
  expect(workflow.functions.map((f) => f.id())).toContain(
    "layout-illustration-one-v1",
  );
});
it("creates no generation function or event when the service is absent, and leaves an unsuccessful dispatch durable", async () => {
  const disabled = createCommercialInngestWorkflows(
      database,
      "test-event-key",
      "signkey-test-only",
    ),
    send = vi.spyOn(disabled.client, "send");
  expect(await disabled.dispatchIllustrations()).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(disabled.functions.map((f) => f.id())).not.toContain(
    "layout-illustration-one-v1",
  );
  const workflow = createCommercialInngestWorkflows(
    database,
    "test-event-key",
    "signkey-test-only",
    undefined,
    undefined,
    undefined,
    {
      process: vi.fn(),
      pending: async () => [{ id: randomUUID(), version: 1 }],
    },
  );
  vi.spyOn(workflow.client, "send").mockRejectedValue(
    Error("QUEUE_UNAVAILABLE"),
  );
  await expect(workflow.dispatchIllustrations()).rejects.toThrow(
    "QUEUE_UNAVAILABLE",
  );
});
it("never persists quote authorization, source bindings or provider data into an Inngest step result", async () => {
  const { illustrationGenerationStage } =
      await import("../commercial/inngest-workflows"),
    { illustrationGenerationFixture } =
      await import("../../../../scripts/test-layout-illustration-generation"),
    { LayoutIllustrationGenerationRepository } =
      await import("../../../mobile/src/copilot/layout-illustration-generation-repository"),
    { illustrationDigest } =
      await import("../../../../scripts/test-layout-illustration-preparations"),
    f = await illustrationGenerationFixture();
  try {
    const record = await new LayoutIllustrationGenerationRepository(
      f.a,
      f.scope,
      illustrationDigest,
      f.now,
    ).confirm(f.card, f.quote, f.ids);
    const result = await illustrationGenerationStage(
      { process: async () => record },
      record.id,
    );
    expect(result).toEqual({
      id: record.id,
      status: "QUEUED",
      recoverAt: null,
    });
    expect(JSON.stringify(result)).not.toContain(f.quote.signature);
    expect(JSON.stringify(result)).not.toContain("preparation");
    expect(JSON.stringify(result)).not.toContain("policy");
  } finally {
    f.db.close();
  }
});
