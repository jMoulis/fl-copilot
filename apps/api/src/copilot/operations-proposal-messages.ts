import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotOperationsPreviewSchema,
  copilotOperationsProposalSchema,
  readCopilotOperationsProposal,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildOperationsProposalMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const latest = new Map<
    string,
    ReturnType<typeof copilotOperationsPreviewSchema.parse>
  >();
  for (const r of raw) {
    const result = copilotOperationsPreviewSchema.parse(r);
    if (
      [result.basis.product, result.basis.event, result.basis.settings].some(
        (e) => e && e.storeId !== assistant.storeId,
      )
    )
      throw Error("COPILOT_OPERATIONS_PROPOSAL_SCOPE_INVALID");
    const key =
      result.input.kind === "SETTINGS"
        ? "SETTINGS"
        : result.input.kind === "FIELD_CLOSE"
          ? result.input.eventId
          : JSON.stringify([
              result.input.productId,
              result.input.patch.type,
              result.input.patch.startedAt
                ? new Date(result.input.patch.startedAt).toISOString()
                : null,
            ]);
    latest.set(key, result);
  }
  const ready = [...latest.values()].filter((r) => r.status === "READY");
  if (ready.length > 3) throw Error("COPILOT_OPERATIONS_PROPOSAL_LIMIT");
  return ready.map((result) => {
    const content = copilotOperationsProposalSchema.parse({
      kind: "STORE_OPERATIONS_PROPOSAL",
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
    readCopilotOperationsProposal(message);
    return message;
  });
}
