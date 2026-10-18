import { createHash } from "node:crypto";
import {
  isNeedConflictKind,
  copilotMessageSchema,
  storeConflictPreviewSchema,
  storeConflictProposalSchema,
  readStoreConflictProposal,
  validateStoreConflictBasis,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildStoreConflictMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof storeConflictPreviewSchema.parse>
  >();
  for (const value of raw) {
    const preview = storeConflictPreviewSchema.parse(value);
    validateStoreConflictBasis(assistant.storeId, preview.input, preview.basis);
    latest.set(`${preview.input.kind}/${preview.basis.entityId}`, preview);
  }
  if (latest.size > 3) throw Error("STORE_CONFLICT_PROPOSAL_LIMIT");
  return [...latest.values()].map((p) => {
    const content = storeConflictProposalSchema.parse({
      kind: "STORE_CONFLICT_PROPOSAL",
      schemaVersion: isNeedConflictKind(p.input.kind) ? 2 : 1,
      assistantMessageId: assistant.id,
      input: p.input,
      basis: p.basis,
    });
    const hex = createHash("sha256")
      .update(assistant.id + JSON.stringify(content))
      .digest("hex");
    const message = copilotMessageSchema.parse({
      ...assistant,
      id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
      role: "TOOL",
      text: JSON.stringify(content),
      attachments: [],
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
    });
    readStoreConflictProposal(message);
    return message;
  });
}
