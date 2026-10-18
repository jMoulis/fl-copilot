import { randomUUID } from "node:crypto";
import {
  copilotMessageSchema,
  receiptPublicationPreviewSchema,
  receiptPublicationSourceSchema,
  wasteReceiptDraftSchema,
} from "../packages/domain/src/index";
import { chatFixture } from "./test-chat-fixtures";
import { wastePublicationFixture } from "./test-waste-publication-fixtures";
export function receiptPublicationChatFixture() {
  const p = wastePublicationFixture(),
    chat = chatFixture(randomUUID);
  chat.storeId = p.receipt.storeId;
  chat.conversation.storeId = chat.storeId;
  chat.message.storeId = chat.storeId;
  chat.conversation.createdAt = p.receipt.createdAt;
  chat.conversation.updatedAt = p.receipt.updatedAt;
  chat.message.createdAt = p.receipt.createdAt;
  chat.message.text = "Publie ce ticket de casse après vérification.";
  chat.message.attachments = [];
  const source = receiptPublicationSourceSchema.parse({
    storeId: chat.storeId,
    sourceDocumentId: p.source.id,
    checksum: p.source.checksum,
    filename: p.source.originalFilename,
  });
  const preview = receiptPublicationPreviewSchema.parse({
    input: { sourceDocumentId: p.source.id },
    source,
    status: "REVIEW_LOCAL",
    evidence: [
      {
        id: `receipt-publication/${p.source.id}`,
        sourceType: "DATA_QUALITY",
        sourceId: p.source.id,
        sourceVersion: null,
        label: "Publication du ticket",
        value: "Revue locale préparée, pas encore publiée.",
        factKind: "QUALITY",
      },
    ],
  });
  const assistant = copilotMessageSchema.parse({
    ...chat.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: chat.message.id,
    text: "Voici le ticket à relire avant publication.",
    createdAt: new Date(
      Date.parse(chat.message.createdAt) + 60000,
    ).toISOString(),
  });
  const draft = wasteReceiptDraftSchema.parse({
    detectedReceiptDate: p.receipt.detectedReceiptDate,
    detectedCashierNumber: p.receipt.detectedCashierNumber,
    extractionModelVersion: "fixture",
    arithmeticValidatorVersion: "fixture",
    productMatcherVersion: "fixture",
    lines: p.lines.map((l) => ({
      lineId: l.id,
      sourceLineIndex: l.sourceLineIndex,
      rawLabel: l.rawLabel,
      quantity: l.quantity ?? null,
      weight: l.weight ?? null,
      quantityUnit: l.quantityUnit ?? "UNKNOWN",
      unitPrice: l.unitPrice ?? null,
      totalPrice: l.totalPrice ?? null,
      extractionConfidence: null,
      sourceRegion: null,
      arithmeticStatus: "CONSISTENT",
      arithmeticExpectedTotal: l.totalPrice ?? null,
      arithmeticDifference: "0",
      arithmeticWarningCode: null,
      matchState: l.matchedProductId ? "AUTO_MATCH" : "NO_MATCH",
      matchedProductId: l.matchedProductId ?? null,
      matchedProductLabel: l.matchedProductId ? "FIGUE VRAC" : null,
      matchConfidence: l.matchedProductId ? 1 : null,
      productNature: l.productNature,
      candidates: [],
      validationStatus: "PENDING",
    })),
  });
  return { p, chat, source, preview, assistant, draft };
}
