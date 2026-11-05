import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { applyCopilotRecord } from "../copilot/conversation-repository";
import { chatNotificationDestination } from "./chat-destination";
async function fixture() {
  const f = chatFixture(randomUUID),
    db = new DatabaseSync(":memory:"),
    a = new ReceiptTestDatabase(db);
  await runLocalMigrations(a);
  const reply = {
    ...f.message,
    id: randomUUID(),
    role: "ASSISTANT" as const,
    text: "Réponse privée",
    replyToMessageId: f.message.id,
    attachments: [],
  };
  await applyCopilotRecord(
    a,
    { storeId: f.storeId, ownerId: f.ownerId },
    "copilot_conversation",
    f.conversation,
  );
  await applyCopilotRecord(
    a,
    { storeId: f.storeId, ownerId: f.ownerId },
    "copilot_message",
    f.message,
  );
  await applyCopilotRecord(
    a,
    { storeId: f.storeId, ownerId: f.ownerId },
    "copilot_message",
    reply,
  );
  const data = {
    kind: "COPILOT_REPLY_READY" as const,
    ownerId: f.ownerId,
    storeId: f.storeId,
    conversationId: f.conversation.id,
    replyId: reply.id,
  };
  return {
    f,
    db,
    a,
    reply,
    data,
    scope: { ownerId: f.ownerId, storeId: f.storeId },
  };
}
it("opens the exact owned conversation from retained SQLite data", async () => {
  const x = await fixture();
  try {
    expect(await chatNotificationDestination(x.a, x.scope, x.data)).toEqual({
      pathname: "/(tabs)/copilot",
      params: { conversationId: x.f.conversation.id },
    });
  } finally {
    x.db.close();
  }
});
it("refuses foreign owner/store, arbitrary URL and absent reply", async () => {
  const x = await fixture();
  try {
    for (const raw of [
      { ...x.data, ownerId: randomUUID() },
      { ...x.data, storeId: randomUUID() },
      { ...x.data, url: "https://example.com" },
      { ...x.data, replyId: randomUUID() },
    ])
      expect(
        await chatNotificationDestination(x.a, x.scope, raw),
      ).toBeUndefined();
  } finally {
    x.db.close();
  }
});
it("does not resurrect a removed conversation", async () => {
  const x = await fixture();
  try {
    await applyCopilotRecord(x.a, x.scope, "copilot_conversation", {
      ...x.f.conversation,
      version: 2,
      status: "ARCHIVED",
      updatedAt: "2026-11-05T00:00:00Z",
      deletedAt: "2026-11-05T00:00:00Z",
    });
    expect(
      await chatNotificationDestination(x.a, x.scope, x.data),
    ).toBeUndefined();
  } finally {
    x.db.close();
  }
});
