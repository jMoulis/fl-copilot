import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { choiceCreateFixture } from "../../../../scripts/test-choice-create-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  choiceCreateRequest,
  copilotChoiceCreateInputSchema,
  readCopilotChoiceCreateProposal,
} from "@fl-copilot/domain";
import { buildChoiceCreateProposalMessages } from "./choice-create-messages";
it("prepares source-bound initial retention without model labels/authority and binds a stable private review", async () => {
  const { f, input, basis } = await choiceCreateFixture(),
    request = choiceCreateRequest(input, basis, randomUUID()),
    chat = chatFixture(randomUUID);
  expect(request.input).toMatchObject({
    expectedVersion: null,
    productVersion: f.product.version,
    draft: {
      source: f.choice.source,
      operationLabel: f.choice.operationLabel,
      rawProductLabel: f.choice.rawProductLabel,
      productId: f.product.id,
      status: "RETAINED",
      applicabilityConfirmed: true,
      criticalFieldsConfirmed: true,
    },
  });
  const assistant = {
      ...chat.message,
      id: randomUUID(),
      storeId: f.storeId,
      role: "ASSISTANT" as const,
      replyToMessageId: chat.message.id,
      attachments: [],
    },
    preview = {
      input,
      basis,
      status: "READY",
      existingChoice: null,
      evidence: [
        {
          id: "new-choice",
          sourceType: "DATA_QUALITY",
          sourceId: f.sourceDocumentId,
          sourceVersion: 1,
          label: "À retenir",
          value: "À confirmer",
          factKind: "QUALITY",
        },
      ],
    };
  const cards = buildChoiceCreateProposalMessages(assistant, [preview]);
  expect(buildChoiceCreateProposalMessages(assistant, [preview])).toEqual(
    cards,
  );
  expect(readCopilotChoiceCreateProposal(cards[0]).request).toEqual({
    ...request,
    operationId: cards[0]!.id,
  });
  expect(() =>
    buildChoiceCreateProposalMessages({ ...assistant, storeId: randomUUID() }, [
      preview,
    ]),
  ).toThrow("SCOPE");
  expect(
    buildChoiceCreateProposalMessages(assistant, [
      preview,
      {
        ...preview,
        status: "ALREADY_EXISTS",
        basis: null,
        existingChoice: { id: f.choice.id, status: "WITHDRAWN", version: 1 },
      },
    ]),
  ).toEqual([]);
});
it("rejects forged source/product scope, invalid complete terms and model confirmation/status injection", async () => {
  const { input, basis } = await choiceCreateFixture();
  for (const extra of [
    { storeId: randomUUID() },
    { expectedVersion: 1 },
    { criticalFieldsConfirmed: true },
    { applicabilityConfirmed: true },
    { rawProductLabel: "invented" },
    { status: "RETAINED" },
  ])
    expect(
      copilotChoiceCreateInputSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
  for (const b of [
    { ...basis, storeId: randomUUID() },
    { ...basis, product: { ...basis.product, id: randomUUID() } },
    { ...basis, product: { ...basis.product, status: "INACTIVE" as const } },
    {
      ...basis,
      offer: { ...basis.offer, source: { ...input.source, itemIndex: 1 } },
    },
  ])
    expect(() => choiceCreateRequest(input, b, randomUUID())).toThrow();
  expect(() =>
    choiceCreateRequest(
      { ...input, saleEnd: "2020-01-01" },
      basis,
      randomUUID(),
    ),
  ).toThrow();
  expect(() =>
    choiceCreateRequest(
      {
        ...input,
        mechanism: {
          type: "LOT",
          lotQuantity: 2,
          totalPrice: 9,
          unitPrice: 2,
          unit: "PIECE",
        },
      },
      basis,
      randomUUID(),
    ),
  ).toThrow();
});
