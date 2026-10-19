import { createHash } from "node:crypto";
import {
  copilotLayoutEditPreviewSchema,
  copilotLayoutEditProposalSchema,
  readCopilotLayoutEditProposal,
  copilotMessageSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
/** One final physical intent per answer; a second proposal cannot silently replace its base after confirmation. */
export function buildStoreLayoutEditMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const last = raw.at(-1);
  if (!last) return [];
  const preview = copilotLayoutEditPreviewSchema.parse(last);
  if (preview.basis && preview.basis.storeId !== assistant.storeId)
    throw Error("LAYOUT_PROPOSAL_SCOPE");
  if (preview.status !== "READY") return [];
  const content = copilotLayoutEditProposalSchema.parse({
    kind: "STORE_LAYOUT_EDIT_PROPOSAL",
    schemaVersion: 1,
    assistantMessageId: assistant.id,
    input: preview.input,
    basis: preview.basis,
    created: preview.created,
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
  readCopilotLayoutEditProposal(message);
  return [message];
}
