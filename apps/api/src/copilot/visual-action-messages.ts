import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  visualActionPreviewSchema,
  visualActionProposalSchema,
  readVisualActionProposal,
  validateVisualActionPreview,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildVisualActionMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof visualActionPreviewSchema.parse>
  >();
  for (const value of raw) {
    const p = visualActionPreviewSchema.parse(value);
    validateVisualActionPreview(assistant.storeId, p.input, p);
    latest.set(p.input.productId, p);
  }
  const ready = [...latest.values()].filter((p) =>
    ["READY", "REVIEW_LOCAL"].includes(p.status),
  );
  if (ready.length > 3) throw Error("VISUAL_ACTION_LIMIT");
  return ready.map((p) => {
    const content = visualActionProposalSchema.parse({
      kind: "VISUAL_ACTION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: p.input,
      basis: p.basis,
    });
    const hex = createHash("sha256")
        .update(assistant.id + JSON.stringify(content))
        .digest("hex"),
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const message = copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      text: JSON.stringify(content),
      attachments: [],
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
    });
    readVisualActionProposal(message);
    return message;
  });
}
