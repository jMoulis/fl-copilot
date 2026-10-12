import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { copilotMessageSchema } from "@fl-copilot/domain";
import type { MongoCommandMutationContext } from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import { appendCopilotResponse } from "./response-store";
function fixture() {
  const storeId = randomUUID(),
    ownerId = randomUUID(),
    conversationId = randomUUID(),
    parentId = randomUUID();
  const now = "2026-10-12T12:00:00.000Z";
  const message = copilotMessageSchema.parse({
    id: randomUUID(),
    storeId,
    ownerId,
    conversationId,
    role: "ASSISTANT",
    text: "Réponse de test",
    attachments: [],
    replyToMessageId: parentId,
    supersedesMessageId: null,
    version: 1,
    createdAt: now,
  });
  const parent = { ...message, _id: parentId, id: parentId, role: "USER" };
  const conversation = {
    _id: conversationId,
    id: conversationId,
    storeId,
    ownerId,
    title: "Ventes",
    status: "ACTIVE",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  let saved: object | null = null;
  const insertOne = vi.fn(async (row: object) => {
    saved = row;
  });
  const findOne = vi.fn(async (filter: { _id: string }) =>
    filter._id === parentId ? parent : saved,
  );
  const collection = vi.fn((name: string) =>
    name === "copilotConversations"
      ? { findOne: vi.fn(async () => conversation) }
      : { findOne, insertOne },
  );
  const ctx = {
    database: { collection },
    session: { inTransaction: () => true },
  } as unknown as MongoCommandMutationContext;
  const changes = {
    append: vi.fn(async () => undefined),
  } as unknown as ReturnType<typeof createMongoSyncChangeService>;
  return {
    ctx,
    changes,
    message,
    authority: { storeId, ownerId, canRespond: true },
    conversation,
    findOne,
    insertOne,
  };
}
it("publishes once and rechecks authority before an identical replay", async () => {
  const f = fixture();
  expect(
    (await appendCopilotResponse(f.ctx, f.authority, f.message, f.changes))
      .alreadyApplied,
  ).toBe(false);
  expect(
    (await appendCopilotResponse(f.ctx, f.authority, f.message, f.changes))
      .alreadyApplied,
  ).toBe(true);
  expect(f.insertOne).toHaveBeenCalledTimes(1);
  expect(f.changes.append).toHaveBeenCalledTimes(1);
  await expect(
    appendCopilotResponse(
      f.ctx,
      { ...f.authority, canRespond: false },
      f.message,
      f.changes,
    ),
  ).rejects.toThrow("COPILOT_REPLY_ACCESS_INVALID");
  await expect(
    appendCopilotResponse(
      f.ctx,
      f.authority,
      { ...f.message, text: "Changed" },
      f.changes,
    ),
  ).rejects.toThrow("COPILOT_REPLY_IDENTITY_CONFLICT");
});
it("rejects archived conversation and requires an active transaction", async () => {
  const f = fixture();
  f.conversation.status = "ARCHIVED";
  await expect(
    appendCopilotResponse(f.ctx, f.authority, f.message, f.changes),
  ).rejects.toThrow("COPILOT_REPLY_CONVERSATION_ARCHIVED");
  expect(f.insertOne).not.toHaveBeenCalled();
  f.ctx.session.inTransaction = () => false;
  await expect(
    appendCopilotResponse(f.ctx, f.authority, f.message, f.changes),
  ).rejects.toThrow("COPILOT_REPLY_TRANSACTION_REQUIRED");
});
