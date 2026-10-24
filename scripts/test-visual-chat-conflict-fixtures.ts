import { randomUUID } from "node:crypto";
import {
  copilotMessageSchema,
  copilotVisualTypes,
  type CopilotVisualKind,
} from "../packages/domain/src/index";
import { nativeVisualConflictFixture } from "./test-visual-conflict-fixtures";
import { chatFixture } from "./test-chat-fixtures";
import { storeConflictPreview } from "./test-store-conflict-fixtures";
import { buildStoreConflictMessages } from "../apps/api/src/copilot/store-conflict-messages";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotStoreConflictController } from "../apps/mobile/src/copilot/store-conflict-controller";
import { receiptReviewDigest } from "./test-receipt-publication-sqlite";
export async function nativeVisualChatConflictFixture(
  kind: CopilotVisualKind,
  path = ":memory:",
  retired?: "LOCAL" | "REMOTE",
) {
  const s = await nativeVisualConflictFixture(
    copilotVisualTypes[kind],
    path,
    retired,
  );
  return {
    ...s,
    ...(await prepareVisualChatReview(s.a, s.scope, kind, s.review.remote)),
  };
}
export async function prepareVisualChatReview(
  database: import("../apps/mobile/src/sync/outbox-repository").OutboxDatabase &
    import("../apps/mobile/src/sync/atomic-local-mutation").AtomicMutationDatabase,
  sourceScope: { storeId: string; ownerId: string; deviceId: string },
  kind: CopilotVisualKind,
  remote: { id: string; storeId: string; version: number },
  preparedPreview?: ReturnType<typeof storeConflictPreview>,
) {
  const chat = chatFixture(randomUUID);
  chat.storeId = sourceScope.storeId;
  chat.ownerId = sourceScope.ownerId;
  chat.deviceId = sourceScope.deviceId;
  Object.assign(chat.conversation, {
    storeId: chat.storeId,
    ownerId: chat.ownerId,
  });
  Object.assign(chat.message, {
    storeId: chat.storeId,
    ownerId: chat.ownerId,
    text: "Compare les versions de cette image avant de choisir.",
    attachments: [],
  });
  const conversation = new CopilotConversationRepository(database, chat);
  await conversation.save(chat.conversation, {
    commandId: randomUUID(),
    deviceId: chat.deviceId,
  });
  await conversation.append(chat.message, {
    commandId: randomUUID(),
    deviceId: chat.deviceId,
  });
  const assistant = copilotMessageSchema.parse({
      ...chat.message,
      id: randomUUID(),
      role: "ASSISTANT",
      replyToMessageId: chat.message.id,
      text: "Voici la comparaison à examiner.",
    }),
    preview = preparedPreview ?? storeConflictPreview(kind, remote),
    message = buildStoreConflictMessages(assistant, [preview])[0]!;
  await database.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, chat, "copilot_message", assistant);
    await applyCopilotRecord(tx, chat, "copilot_message", message);
  });
  const scope = {
      ...sourceScope,
      canManageVisualLibrary: true,
      canCaptureStoreEvents: false,
      canManageStoreSettings: false,
    },
    controller = new CopilotStoreConflictController(
      database,
      scope,
      receiptReviewDigest,
      randomUUID,
    );
  return {
    chat,
    assistant,
    preview,
    message,
    chatScope: scope,
    controller,
    state: await controller.open(message),
  };
}
