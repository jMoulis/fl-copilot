import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  receiptCorrectionPreviewSchema,
  receiptCorrectionProposalSchema,
  readReceiptCorrectionProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildReceiptCorrectionMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof receiptCorrectionPreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = receiptCorrectionPreviewSchema.parse(r);
    if (
      result.source.storeId !== assistant.storeId ||
      result.source.sourceDocumentId !== result.input.sourceDocumentId
    )
      throw Error("COPILOT_RECEIPT_CORRECTION_PROPOSAL_SCOPE_INVALID");
    latest.set(result.input.sourceDocumentId, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "REVIEW_LOCAL");
  if (ready.length > 3)
    throw Error("COPILOT_RECEIPT_CORRECTION_PROPOSAL_LIMIT");
  return ready.map((result) => {
    const content = receiptCorrectionProposalSchema.parse({
      kind: "WASTE_CORRECTION_PROPOSAL",
      schemaVersion: result.schemaVersion ?? 1,
      assistantMessageId: assistant.id,
      source: result.source,
      input: result.input,
    });
    const hex = createHash("sha256")
      .update(assistant.id + JSON.stringify(content))
      .digest("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const message = copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      text: JSON.stringify(content),
      attachments: [],
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
    });
    readReceiptCorrectionProposal(message);
    return message;
  });
}
