import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  actionExecutionPreviewSchema,
  actionExecutionProposalSchema,
  type CopilotMessage,
  readActionExecutionProposal,
  recommendationTrackingIdentityPayload,
  recommendationIdFromDigest,
} from "@fl-copilot/domain";
export function buildActionExecutionMessages(
  assistant: CopilotMessage,
  raw: unknown[],
) {
  const ready = new Map<
    string,
    ReturnType<typeof actionExecutionPreviewSchema.parse>
  >();
  for (const r of raw) {
    const v = actionExecutionPreviewSchema.parse(r);
    ready.set(JSON.stringify(v.input), v);
  }
  const values = [...ready.values()].filter((r) => r.status === "READY");
  if (values.length > 3) throw Error("ACTION_EXECUTION_PROPOSAL_LIMIT");
  return values.map((v) => {
    const content = actionExecutionProposalSchema.parse({
      kind: "ACTION_EXECUTION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      recommendationId: recommendationIdFromDigest(
        createHash("sha256")
          .update(
            recommendationTrackingIdentityPayload(assistant, v.snapshot!.basis),
          )
          .digest("hex"),
      ),
      input: v.input,
      snapshot: v.snapshot,
    });
    const h = createHash("sha256")
        .update(assistant.id + JSON.stringify(content))
        .digest("hex"),
      id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const message = copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      text: JSON.stringify(content),
      attachments: [],
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
    });
    readActionExecutionProposal(message);
    return message;
  });
}
