import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import {
  copilotMessageSchema,
  copilotPriceScenarioInputSchema,
  priceScenarioFormStateSchema,
  readPriceScenarioQuestion,
  priceScenarioBasisToken,
  priceScenarioInformationInput,
  type PriceScenarioFormState,
} from "@fl-copilot/domain";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { buildPriceScenarioFormMessages } from "./price-scenario-messages";
it.each(["KG", "PIECE", "PACK"] as const)(
  "uses existing four-field private forms with explicit HT/unit labels (%s)",
  (unit) => {
    const chat = chatFixture(randomUUID);
    const assistant = copilotMessageSchema.parse({
      ...chat.message,
      role: "ASSISTANT",
      id: randomUUID(),
      replyToMessageId: chat.message.id,
      attachments: [],
      text: "Précisons les hypothèses.",
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
    const cards = buildPriceScenarioFormMessages(assistant, [state]);
    expect(cards).toHaveLength(1);
    expect(buildPriceScenarioFormMessages(assistant, [state])).toEqual(cards);
    const parsed = readPriceScenarioQuestion(cards[0]);
    expect(parsed.state).toEqual(state);
    expect(parsed.definition.prefill).toEqual({});
    expect(parsed.definition.fields).toHaveLength(4);
    expect(parsed.definition.fields[2]?.label).toContain("connu HT");
    expect(parsed.definition.basisToken.length).toBeLessThanOrEqual(256);
    expect(() =>
      readPriceScenarioQuestion({
        ...cards[0],
        text: JSON.stringify({
          ...parsed.content,
          definition: { ...parsed.definition, title: "Coût TTC" },
        }),
      }),
    ).toThrow();
    expect(() =>
      readPriceScenarioQuestion({ ...cards[0], role: "USER" }),
    ).toThrow();
  },
);
it("keeps prior assumptions visible and asks only for the blocked field", () => {
  const state: PriceScenarioFormState = {
    unit: "PACK",
    values: [
      "999999999999.999999",
      "999999999999.999999",
      "999999999999.999999",
      "999999999999.999999",
    ],
    fields: ["purchase_cost"],
  };
  const request = priceScenarioInformationInput(state);
  expect(request.fields.map((f) => f.key)).toEqual(["purchase_cost"]);
  expect(request.reason).toContain("Conservé :");
  expect(request.reason).not.toContain("Coût d’achat");
  expect(priceScenarioBasisToken(state).length).toBeLessThanOrEqual(256);
  expect(
    priceScenarioFormStateSchema.safeParse({
      ...state,
      values: [null, "2", "1", "10"],
    }).success,
  ).toBe(false);
  expect(
    copilotPriceScenarioInputSchema.safeParse({
      action: "PREPARE",
      unit: "KG",
      purchaseCost: "1",
    }).success,
  ).toBe(false);
  expect(
    copilotPriceScenarioInputSchema.safeParse({
      action: "CALCULATE",
      answerMessageId: randomUUID(),
      quality: "KNOWN",
    }).success,
  ).toBe(false);
});
