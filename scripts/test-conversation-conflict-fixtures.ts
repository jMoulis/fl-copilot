import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { chatFixture } from "./test-chat-fixtures";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "../apps/mobile/src/copilot/conversation-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { copilotConversationSchema } from "../packages/domain/src/index";
export async function nativeConversationConflictFixture(
  path = ":memory:",
  deletion?: "CONVERSATION" | "MESSAGE",
) {
  const db = new DatabaseSync(path),
    a = new ReceiptTestDatabase(db),
    f = chatFixture(randomUUID),
    scope = { storeId: f.storeId, ownerId: f.ownerId, deviceId: f.deviceId },
    repo = new CopilotConversationRepository(a, scope, receiptReviewDigest),
    ctx = () => ({ commandId: randomUUID(), deviceId: f.deviceId });
  await runLocalMigrations(a);
  await repo.save(f.conversation, ctx());
  await applyCopilotRecord(a, f, "copilot_conversation", f.conversation, 1);
  await a.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  await repo.append(f.message, { ...ctx(), replyId: randomUUID() });
  await repo.saveDraft(f.conversation.id, {
    text: "Brouillon à garder",
    attachments: f.message.attachments,
    updatedAt: f.conversation.updatedAt,
  });
  if (deletion)
    await repo.remove(
      f.conversation.id,
      deletion === "MESSAGE" ? f.message.id : null,
      ctx(),
      "2026-10-15T14:00:00.000Z",
    );
  else
    await repo.save(
      { ...f.conversation, title: "Titre local", version: 2 },
      ctx(),
    );
  const remote = copilotConversationSchema.parse({
      ...f.conversation,
      title: "Titre synchronisé",
      version: 2,
    }),
    local = (await repo.get(f.conversation.id))!;
  await applyCopilotRecord(a, f, "copilot_conversation", remote);
  const command = (await new OutboxRepository(a).listPending(f.storeId)).find(
      (c) => c.entityType === "copilot_conversation",
    )!,
    conflict = await new ConflictRepository(a).recordPushConflict(command, {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: remote.id,
      remoteVersion: 2,
      remoteEntity: remote,
    });
  await a.runAsync(
    "UPDATE copilot_conversations SET sync_state='CONFLICT' WHERE id=?",
    remote.id,
  );
  await a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  return {
    db,
    a,
    f,
    scope,
    ctx,
    count,
    review: {
      kind: "CONVERSATION" as const,
      table: "copilot_conversations",
      entityType: "copilot_conversation",
      scope,
      repo,
      local,
      remote,
      command,
      conflict,
    },
  };
}
