import { randomUUID } from "node:crypto";
import {
  receiptPublicationPreviewSchema,
  receiptRecoveryInputSchema,
  receiptRecoveryPreviewSchema,
  type receiptRecoveryActionSchema,
} from "../packages/domain/src/index";
import type { z } from "zod";
import { receiptPublicationChatFixture } from "./test-receipt-publication-fixtures";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { buildReceiptRecoveryMessages } from "../apps/api/src/copilot/receipt-recovery-messages";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import {
  CopilotReceiptRecoveryController,
  CopilotReceiptRecoveryRuntime,
} from "../apps/mobile/src/copilot/receipt-recovery-controller";
export function receiptRecoveryFixture(
  action: z.infer<typeof receiptRecoveryActionSchema> = "RETRY_PROCESSING",
) {
  const base = receiptPublicationChatFixture(),
    input = receiptRecoveryInputSchema.parse({
      sourceDocumentId: base.source.sourceDocumentId,
      action,
    });
  return {
    ...base,
    input,
    preview: receiptRecoveryPreviewSchema.parse({ ...base.preview, input }),
  };
}
export async function nativeReceiptRecoveryFixture(
  action: z.infer<typeof receiptRecoveryActionSchema> = "RETRY_PROCESSING",
  path = ":memory:",
) {
  const f = receiptRecoveryFixture(action),
    s = await nativeReceiptPublicationFixture(path, {
      ...f,
      preview: receiptPublicationPreviewSchema.parse({
        ...f.preview,
        input: { sourceDocumentId: f.source.sourceDocumentId },
      }),
    });
  let source = f.source,
    receiptId = f.p.receipt.id;
  await s.a.runAsync(
    "UPDATE local_jobs SET status='COMPLETED' WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
  );
  if (action === "RETRY_PROCESSING") {
    await s.a.runAsync("DELETE FROM waste_lines WHERE receipt_id=?", receiptId);
    await s.a.runAsync(
      "UPDATE waste_receipts SET processing_status='FAILED',ai_status='FAILED',duplicate_status='UNIQUE' WHERE id=?",
      receiptId,
    );
    await s.a.runAsync(
      "UPDATE local_jobs SET status='FAILED',last_error='SOURCE_UPLOAD_FAILED' WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
    );
  } else {
    const captured = await s.repo.createCapturedDraft({
      receiptId: randomUUID(),
      fileId: randomUUID(),
      sourceDocumentId: randomUUID(),
      uploadJobId: randomUUID(),
      storeId: s.scope.storeId,
      capturedAt: new Date().toISOString(),
      file: {
        originalFilename: "copie.jpg",
        localUri: "file:///duplicate.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100,
        checksum: source.checksum,
      },
    });
    receiptId = captured.receipt.id;
    source = {
      ...source,
      sourceDocumentId: captured.document.id,
      filename: "copie.jpg",
    };
  }
  const input = receiptRecoveryInputSchema.parse({
      sourceDocumentId: source.sourceDocumentId,
      action,
    }),
    preview = receiptRecoveryPreviewSchema.parse({
      ...f.preview,
      input,
      source,
    }),
    message = buildReceiptRecoveryMessages(f.assistant, [preview])[0]!;
  await s.a.withExclusiveTransactionAsync((tx) =>
    applyCopilotRecord(tx, f.chat, "copilot_message", message),
  );
  const scope = {
      storeId: s.scope.storeId,
      ownerId: s.scope.ownerId,
      deviceId: s.scope.deviceId,
      canRecoverWaste: true,
    },
    controller = new CopilotReceiptRecoveryController(
      s.a,
      scope,
      receiptReviewDigest,
      randomUUID,
    ),
    state = await controller.open(message);
  if (!state.review) throw Error("Expected recovery review");
  const request = {
    operationId: message.id,
    sourceDocumentId: source.sourceDocumentId,
    receiptId,
    basisHash: state.review.basisHash,
    action,
  };
  const authority = {
    ...scope,
    recoveryReviewed: true,
    conversationId: message.conversationId,
    userMessageId: message.replyToMessageId!,
    authorizedRequestJson: JSON.stringify(request),
    decisionLevel: "REVIEWED" as const,
  };
  return {
    ...s,
    recovery: {
      source,
      input,
      preview,
      message,
      receiptId,
      scope,
      controller,
      state,
      request,
      authority,
      runtime: new CopilotReceiptRecoveryRuntime(
        s.a,
        receiptReviewDigest,
        randomUUID,
      ),
    },
  };
}
