import {
  type ReceiptCorrectionInput,
  receiptCorrectionInputSchema,
  receiptCorrectionPreviewSchema,
  receiptPublicationPreviewSchema,
} from "../packages/domain/src/index";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { buildReceiptCorrectionMessages } from "../apps/api/src/copilot/receipt-correction-messages";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import {
  CopilotReceiptCorrectionController,
  CopilotReceiptCorrectionRuntime,
} from "../apps/mobile/src/copilot/receipt-correction-controller";
import { receiptCorrectionFixture } from "./test-receipt-correction-fixtures";
export async function nativeReceiptCorrectionFixture(
  path = ":memory:",
  data = receiptCorrectionFixture(),
  patch = data.input.patch,
) {
  const s = await nativeReceiptPublicationFixture(path, {
    ...data,
    preview: receiptPublicationPreviewSchema.parse({
      ...data.preview,
      input: { sourceDocumentId: data.source.sourceDocumentId },
    }),
  });
  // Same candidates the canonical receipt editor can offer; never arbitrary catalogue reassociation.
  await s.a.runAsync(
    "UPDATE waste_lines SET match_candidates_json=? WHERE id=?",
    JSON.stringify([
      {
        productId: s.product.id,
        label: s.product.label,
        nature: s.product.nature,
        salesUnit: s.product.salesUnit,
        score: 0.8,
      },
    ]),
    s.f.p.lines[1]!.id,
  );
  const input: ReceiptCorrectionInput = receiptCorrectionInputSchema.parse({
      sourceDocumentId: s.f.source.sourceDocumentId,
      patch,
    }),
    preview = receiptCorrectionPreviewSchema.parse({ ...data.preview, input });
  const message = buildReceiptCorrectionMessages(s.f.assistant, [preview])[0]!;
  await s.a.withExclusiveTransactionAsync((tx) =>
    applyCopilotRecord(tx, s.f.chat, "copilot_message", message).then(
      () => undefined,
    ),
  );
  const scope = {
    storeId: s.scope.storeId,
    ownerId: s.scope.ownerId,
    deviceId: s.scope.deviceId,
    canCorrectWaste: true,
  };
  const controller = new CopilotReceiptCorrectionController(
      s.a,
      scope,
      receiptReviewDigest,
    ),
    runtime = new CopilotReceiptCorrectionRuntime(s.a, receiptReviewDigest),
    state = await controller.open(message);
  const request = {
      operationId: message.id,
      sourceDocumentId: input.sourceDocumentId,
      receiptId: s.f.p.receipt.id,
      basisHash: state.review!.basisHash,
    },
    authority = {
      ...scope,
      conversationId: s.f.chat.conversation.id,
      userMessageId: s.f.chat.message.id,
      authorizedRequestJson: JSON.stringify(request),
      decisionLevel: "REVIEWED" as const,
      correctionReviewed: true,
    };
  return {
    ...s,
    input,
    correctionMessage: message,
    correctionScope: scope,
    correctionController: controller,
    correctionRuntime: runtime,
    correctionState: state,
    correctionRequest: request,
    correctionAuthority: authority,
  };
}
