import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  identityReviewPreviewSchema,
  identityReviewProposalSchema,
  readIdentityReviewProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildIdentityReviewMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof identityReviewPreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = identityReviewPreviewSchema.parse(r);
    if (result.before && result.before.product.storeId !== assistant.storeId)
      throw Error("COPILOT_IDENTITY_REVIEW_PROPOSAL_SCOPE_INVALID");
    latest.set(`${result.input.kind}/${result.input.entryId}`, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("COPILOT_IDENTITY_REVIEW_PROPOSAL_LIMIT");
  return ready.map((result) => {
    const content = identityReviewProposalSchema.parse({
      kind: "PRODUCT_IDENTITY_REVIEW",
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
    readIdentityReviewProposal(message);
    return message;
  });
}
