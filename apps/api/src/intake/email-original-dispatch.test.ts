import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createCommercialInngestWorkflows } from "../commercial/inngest-workflows.js";
import type { EmailOriginalProcessor } from "./email-originals.js";
const database = {
  getDb: vi.fn(),
  close: async () => {},
  checkHealth: async () => "connected" as const,
};
it("uses the existing durable client and sends only stable job identity, with replay-safe generations", async () => {
  const jobId = randomUUID(),
    receiptId = randomUUID();
  const originals: EmailOriginalProcessor = {
    pending: vi.fn(async () => [{ jobId, generation: 2 }]),
    preserve: vi.fn(),
  };
  const workflows = createCommercialInngestWorkflows(
    database,
    "test-event-key",
    "signkey-test-only",
    undefined,
    originals,
  );
  const send = vi
    .spyOn(workflows.client, "send")
    .mockResolvedValue({ ids: ["event"] });
  expect(await workflows.dispatchEmailOriginals(receiptId)).toBe(1);
  expect(originals.pending).toHaveBeenCalledWith(receiptId);
  expect(send).toHaveBeenCalledWith([
    {
      id: `email-original.v1:${jobId}:2`,
      name: "email/original.preserve",
      data: { jobId },
    },
  ]);
  expect(workflows.functions.map((f) => f.id())).toContain(
    "email-preserve-original-v1",
  );
});
it("propagates dispatch failure so the signed webhook remains retriable after durable admission", async () => {
  const originals: EmailOriginalProcessor = {
    pending: vi.fn(async () => [{ jobId: randomUUID(), generation: 0 }]),
    preserve: vi.fn(),
  };
  const workflows = createCommercialInngestWorkflows(
    database,
    "test-event-key",
    "signkey-test-only",
    undefined,
    originals,
  );
  vi.spyOn(workflows.client, "send").mockRejectedValue(
    Error("test queue unavailable"),
  );
  await expect(workflows.dispatchEmailOriginals(randomUUID())).rejects.toThrow(
    "test queue unavailable",
  );
});
it("does not create receiving work or send events when receiving is disabled", async () => {
  const workflows = createCommercialInngestWorkflows(
    database,
    "test-event-key",
    "signkey-test-only",
  );
  const send = vi.spyOn(workflows.client, "send");
  expect(await workflows.dispatchEmailOriginals()).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(workflows.functions.map((f) => f.id())).not.toContain(
    "email-preserve-original-v1",
  );
});
