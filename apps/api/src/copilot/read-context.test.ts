import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { loadCopilotReadContext } from "./read-context";

it("uses current evaluation time without fabricating action eligibility or priorities", async () => {
  const f = chatFixture(randomUUID);
  const now = "2026-10-12T10:00:00.000Z";
  const context = await loadCopilotReadContext(
    f.storeId,
    f.message,
    () => new Date(now),
  );
  expect(context.batch.storeId).toBe(f.storeId);
  expect(context.batch.evaluatedAt).toBe(now);
  expect(context.batch.candidates).toEqual([]);
  expect(context.intents).toEqual([]);
  expect(context.tradeOffs).toEqual([]);
  await expect(loadCopilotReadContext(randomUUID(), f.message)).rejects.toThrow(
    "COPILOT_CONTEXT_SCOPE_INVALID",
  );
  await expect(
    loadCopilotReadContext(f.storeId, { ...f.message, role: "ASSISTANT" }),
  ).rejects.toThrow("COPILOT_CONTEXT_SCOPE_INVALID");
});
