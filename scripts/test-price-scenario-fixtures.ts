import { randomUUID } from "node:crypto";
import {
  copilotMessageSchema,
  readPriceScenarioQuestion,
  type CopilotMessage,
  type PriceScenarioFormState,
} from "../packages/domain/src/index";
import { chatFixture } from "./test-chat-fixtures";
import { buildPriceScenarioFormMessages } from "../apps/api/src/copilot/price-scenario-messages";
export function scenarioChatFixture(unit: "KG" | "PIECE" | "PACK" = "KG") {
  const chat = chatFixture(randomUUID);
  chat.message = copilotMessageSchema.parse({
    ...chat.message,
    attachments: [],
    text: "Simulons une contre-promo.",
    createdAt: "2026-10-17T10:00:00.000Z",
  });
  const assistant = copilotMessageSchema.parse({
    ...chat.message,
    id: randomUUID(),
    role: "ASSISTANT",
    text: "Précisons les hypothèses HT.",
    replyToMessageId: chat.message.id,
    createdAt: "2026-10-17T10:00:01.000Z",
  });
  const state: PriceScenarioFormState = {
    unit,
    values: [null, null, null, null],
    fields: [
      "current_price",
      "proposed_price",
      "purchase_cost",
      "current_volume",
    ],
  };
  const question = buildPriceScenarioFormMessages(assistant, [state])[0]!;
  const answer = scenarioAnswer(question, ["3", "2,5", "1", "100"]);
  const scope = {
    storeId: chat.storeId,
    ownerId: chat.ownerId,
    conversationId: chat.conversation.id,
    parentMessageId: answer.id,
  };
  return { chat, assistant, question, answer, scope, state };
}
export function scenarioAnswer(question: CopilotMessage, values: string[]) {
  const { definition } = readPriceScenarioQuestion(question);
  return copilotMessageSchema.parse({
    ...question,
    id: randomUUID(),
    role: "USER",
    replyToMessageId: question.id,
    text:
      "Réponse — " +
      definition.title +
      "\n" +
      definition.fields
        .map((f, i) => {
          if (f.type !== "NUMBER") throw Error("BAD_FIXTURE");
          return (
            f.label +
            " : " +
            values[i] +
            (f.unit === "NONE" ? "" : " " + f.unit)
          );
        })
        .join("\n"),
    createdAt: new Date(Date.parse(question.createdAt) + 1000).toISOString(),
  });
}
