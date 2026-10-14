import { createHash } from "node:crypto";
import { z } from "zod";
import {
  copilotInformationInputSchema,
  copilotInformationContentSchema,
  copilotMessageSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildInformationRequestMessages(
  assistant: CopilotMessage,
  raw: unknown,
) {
  const requests = z.array(copilotInformationInputSchema).max(1).parse(raw);
  return requests.map((request) => {
    const checksum = createHash("sha256")
      .update(assistant.id + JSON.stringify(request))
      .digest("hex");
    const id = `${checksum.slice(0, 8)}-${checksum.slice(8, 12)}-4${checksum.slice(13, 16)}-8${checksum.slice(17, 20)}-${checksum.slice(20, 32)}`;
    const content = copilotInformationContentSchema.parse({
      kind: "MISSING_INFORMATION_REQUEST",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      definition: {
        id,
        operationId: id,
        parentUserMessageId: assistant.replyToMessageId,
        basisToken: `information/${checksum}`,
        ...request,
        prefill: {},
      },
    });
    return copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
      text: JSON.stringify(content),
      attachments: [],
    });
  });
}
