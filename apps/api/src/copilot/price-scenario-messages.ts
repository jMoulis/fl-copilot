import { createHash } from "node:crypto";
import { z } from "zod";
import {
  priceScenarioFormStateSchema,
  priceScenarioInformationInput,
  priceScenarioBasisToken,
  copilotInformationContentSchema,
  copilotMessageSchema,
  readPriceScenarioQuestion,
  type CopilotMessage,
} from "@fl-copilot/domain";
export function buildPriceScenarioFormMessages(
  assistant: CopilotMessage,
  raw: unknown,
) {
  return z
    .array(priceScenarioFormStateSchema)
    .max(1)
    .parse(raw)
    .map((state) => {
      const hex = createHash("sha256")
        .update(assistant.id + priceScenarioBasisToken(state))
        .digest("hex");
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      const content = copilotInformationContentSchema.parse({
        kind: "MISSING_INFORMATION_REQUEST",
        schemaVersion: 1,
        assistantMessageId: assistant.id,
        definition: {
          id,
          operationId: id,
          parentUserMessageId: assistant.replyToMessageId,
          basisToken: priceScenarioBasisToken(state),
          ...priceScenarioInformationInput(state),
          prefill: {},
        },
      });
      const message = copilotMessageSchema.parse({
        ...assistant,
        id,
        role: "TOOL",
        text: JSON.stringify(content),
        attachments: [],
        createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
      });
      readPriceScenarioQuestion(message);
      return message;
    });
}
