import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { commercialChoiceFixture } from "../../../../scripts/test-commercial-choice-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  choiceUpdateRequest,
  copilotChoiceUpdateInputSchema,
  readCopilotChoiceUpdateProposal,
} from "@fl-copilot/domain";
import { buildChoiceUpdateProposalMessages } from "./choice-update-messages";
it("patches only requested commercial fields and binds a stable full before/after review", async () => {
  const f = await commercialChoiceFixture(),
    c = chatFixture(randomUUID),
    basis = { before: f.choice, product: f.product };
  const input = copilotChoiceUpdateInputSchema.parse({
    choiceId: f.choice.id,
    patch: { saleEnd: "2026-10-12", note: "Adapter la présentation" },
  });
  const request = choiceUpdateRequest(input, basis, randomUUID());
  expect(request.input).toMatchObject({
    expectedVersion: f.choice.version,
    productVersion: f.product.version,
    draft: {
      productId: f.choice.productId,
      source: f.choice.source,
      saleStart: f.choice.saleStart,
      saleEnd: "2026-10-12",
      mechanism: f.choice.mechanism,
      status: "RETAINED",
      applicabilityConfirmed: true,
      criticalFieldsConfirmed: true,
    },
  });
  const assistant = {
    ...c.message,
    storeId: f.choice.storeId,
    role: "ASSISTANT" as const,
    id: randomUUID(),
    replyToMessageId: c.message.id,
    attachments: [],
  };
  const preview = {
    input,
    basis,
    status: "READY",
    evidence: [
      {
        id: "edit",
        sourceType: "DATA_QUALITY",
        sourceId: f.choice.id,
        sourceVersion: 1,
        label: "Modification",
        value: "À confirmer",
        factKind: "QUALITY",
      },
    ],
  };
  const cards = buildChoiceUpdateProposalMessages(assistant, [preview]);
  expect(buildChoiceUpdateProposalMessages(assistant, [preview])).toEqual(
    cards,
  );
  expect(readCopilotChoiceUpdateProposal(cards[0]).request.input).toEqual(
    request.input,
  );
  expect(() =>
    buildChoiceUpdateProposalMessages({ ...assistant, storeId: randomUUID() }, [
      preview,
    ]),
  ).toThrow("SCOPE");
});
it("rejects source/product/authority injection, invalid complete mechanisms, withdrawn choices and foreign product basis", async () => {
  const f = await commercialChoiceFixture(),
    basis = { before: f.choice, product: f.product },
    input = { choiceId: f.choice.id, patch: { note: "Nouvelle note" } };
  for (const patch of [
    {},
    { productId: randomUUID() },
    { source: f.choice.source },
    { status: "RETAINED" },
    { criticalFieldsConfirmed: true },
    { mechanism: { type: "FIXED_PRICE", amount: 2 } },
  ])
    expect(
      copilotChoiceUpdateInputSchema.safeParse({ ...input, patch }).success,
    ).toBe(false);
  for (const extra of [
    { expectedVersion: 1 },
    { productVersion: 1 },
    { storeId: randomUUID() },
  ])
    expect(
      copilotChoiceUpdateInputSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
  for (const b of [
    { ...basis, before: { ...f.choice, status: "WITHDRAWN" as const } },
    { ...basis, product: { ...f.product, storeId: randomUUID() } },
    { ...basis, product: { ...f.product, status: "INACTIVE" as const } },
  ])
    expect(() => choiceUpdateRequest(input, b, randomUUID())).toThrow();
  expect(() =>
    choiceUpdateRequest(
      { choiceId: f.choice.id, patch: { saleEnd: "2020-01-01" } },
      basis,
      randomUUID(),
    ),
  ).toThrow();
});

it("clears notes with the same empty-to-null semantics as the manual editor", async () => {
  const f = await commercialChoiceFixture(),
    basis = {
      before: { ...f.choice, note: "Ancienne note" },
      product: f.product,
    };
  const input = copilotChoiceUpdateInputSchema.parse({
    choiceId: f.choice.id,
    patch: { note: "   " },
  });
  expect(
    choiceUpdateRequest(input, basis, randomUUID()).input.draft.note,
  ).toBeNull();
  const { choiceUpdateHasChanges } = await import("@fl-copilot/domain");
  expect(choiceUpdateHasChanges(input, { ...f.choice, note: null })).toBe(
    false,
  );
});
