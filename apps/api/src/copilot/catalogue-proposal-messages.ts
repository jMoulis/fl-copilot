import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotCataloguePreviewSchema,
  copilotCatalogueProposalSchema,
  readCopilotCatalogueProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildCatalogueProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotCataloguePreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotCataloguePreviewSchema.parse(r);
    if (
      result.before &&
      result.before.product.entity.storeId !== assistant.storeId
    )
      throw Error("COPILOT_CATALOGUE_PROPOSAL_SCOPE_INVALID");
    latest.set(result.input.productId ?? JSON.stringify(result.input), result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("COPILOT_CATALOGUE_PROPOSAL_LIMIT");
  return ready.map((result) => {
    const content = copilotCatalogueProposalSchema.parse({
      kind: "PRODUCT_CATALOGUE_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: result.input,
      before: result.before,
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
    readCopilotCatalogueProposal(message);
    return message;
  });
}
