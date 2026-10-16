import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotNeedPreviewSchema,
  copilotNeedProposalSchema,
  readCopilotNeedProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildNeedProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotNeedPreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotNeedPreviewSchema.parse(r);
    if (
      [
        result.basis.need,
        result.basis.product,
        result.basis.substitute,
        result.basis.membership,
        result.basis.substitution,
      ].some((e) => e && e.storeId !== assistant.storeId)
    )
      throw Error("COPILOT_NEED_PROPOSAL_SCOPE_INVALID");
    latest.set(
      JSON.stringify([
        result.input.kind,
        result.input.needUnitId,
        "productId" in result.input ? result.input.productId : null,
        "substituteProductId" in result.input
          ? result.input.substituteProductId
          : null,
        result.input.needUnitId === null ? result.input.patch : null,
      ]),
      result,
    );
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("COPILOT_NEED_PROPOSAL_LIMIT");
  return ready.map((result) => {
    const content = copilotNeedProposalSchema.parse({
      kind: "NEED_MUTATION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: result.input,
      basis: result.basis,
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
    readCopilotNeedProposal(message);
    return message;
  });
}
