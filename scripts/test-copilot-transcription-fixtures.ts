import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { CommercialReviewPage } from "../packages/sync-contracts/src/index";
import type { transcriptionReviewPreviewSchema } from "../packages/domain/src/index";
import type { OutboxDatabase } from "../apps/mobile/src/sync/outbox-repository";
import type { AtomicMutationDatabase } from "../apps/mobile/src/sync/atomic-local-mutation";
import { nativeCommercialTranscriptionFixture } from "./test-commercial-transcription-fixtures";
import { serializedTestDatabase } from "./test-serialized-sqlite";
import { chatFixture } from "./test-chat-fixtures";
import { receiptReviewDigest } from "./test-receipt-publication-sqlite";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "../apps/mobile/src/copilot/conversation-repository";
import { buildTranscriptionReviewMessages } from "../apps/api/src/copilot/transcription-review-messages";
import { CopilotTranscriptionReviewController } from "../apps/mobile/src/copilot/transcription-review-controller";
type Scope = { storeId: string; ownerId: string; deviceId: string };
export async function attachTranscriptionChat(
  db: OutboxDatabase & AtomicMutationDatabase,
  base: Scope,
  page: CommercialReviewPage,
  serverPreview?: z.infer<typeof transcriptionReviewPreviewSchema>,
) {
  const chat = chatFixture(randomUUID),
    at = "2026-10-24T08:02:00.000Z";
  Object.assign(chat, base);
  Object.assign(chat.conversation, {
    storeId: base.storeId,
    ownerId: base.ownerId,
  });
  Object.assign(chat.message, {
    storeId: base.storeId,
    ownerId: base.ownerId,
    attachments: [
      {
        sourceDocumentId: page.sourceDocumentId,
        filename: "week.pdf",
        mediaType: "application/pdf",
      },
    ],
  });
  await db.runAsync(
    "INSERT INTO source_documents(id,store_id,source_type,original_filename,local_file_uri,checksum,local_processing_status,remote_upload_status,version,created_at,updated_at,deleted_at,sync_state,remote_version,dirty) VALUES (?,?,'WEEKLY_COMMERCIAL_PDF','week.pdf','file:///retained-week.pdf',?,'VALIDATED','CONFIRMED',1,?,?,NULL,'SYNCED',1,0)",
    page.sourceDocumentId,
    base.storeId,
    page.checksum,
    at,
    at,
  );
  const conversations = new CopilotConversationRepository(db, base);
  await conversations.save(chat.conversation, {
    deviceId: base.deviceId,
    commandId: randomUUID(),
  });
  await conversations.append(chat.message, {
    deviceId: base.deviceId,
    commandId: randomUUID(),
  });
  const assistant = {
    ...chat.message,
    id: randomUUID(),
    role: "ASSISTANT" as const,
    replyToMessageId: chat.message.id,
    text: "Comparons les transcriptions de ce document.",
    attachments: [],
    createdAt: at,
  };
  const source = {
    storeId: base.storeId,
    sourceDocumentId: page.sourceDocumentId,
    checksum: page.checksum,
    filename: "week.pdf",
  };
  const preview = serverPreview ?? {
    input: { sourceDocumentId: page.sourceDocumentId },
    source,
    status: "REVIEW_LOCAL" as const,
    evidence: [
      {
        id: randomUUID(),
        sourceType: "DATA_QUALITY" as const,
        sourceId: page.sourceDocumentId,
        sourceVersion: null,
        label: "Revue de transcription",
        value: "Comparaison locale à ouvrir, aucune résolution.",
        factKind: "QUALITY" as const,
      },
    ],
  };
  const message = buildTranscriptionReviewMessages(assistant, [preview])[0]!;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, base, "copilot_message", assistant);
    await applyCopilotRecord(tx, base, "copilot_message", message);
  });
  const scope = { ...base, canReviewTranscriptions: true };
  const controller = new CopilotTranscriptionReviewController(
    db,
    scope,
    receiptReviewDigest,
    () => at,
  );
  return { scope, chat, assistant, source, preview, message, controller };
}
export async function copilotTranscriptionFixture(
  path = ":memory:",
  additionalBlocks = 0,
) {
  const s = await nativeCommercialTranscriptionFixture(
      path,
      0.8,
      additionalBlocks,
    ),
    db = serializedTestDatabase(s.db);
  return {
    ...s,
    dbAdapter: db,
    ...(await attachTranscriptionChat(db, s.scope, s.page)),
  };
}
