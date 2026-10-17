import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { commercialChoiceFixture } from "../../../../scripts/test-commercial-choice-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  choiceRetentionRequest,
  choiceRetentionBasisSchema,
  copilotChoiceRetentionInputSchema,
  copilotChoiceRetentionPreviewSchema,
  readCopilotChoiceRetentionProposal,
} from "@fl-copilot/domain";
import { buildChoiceRetentionProposalMessages } from "./choice-retention-messages";
it("prepares a new decision reversing only withdrawal, with stable private review and no-op suppression", async () => {
  const f = await commercialChoiceFixture(),
    chat = chatFixture(randomUUID),
    input = { choiceId: f.choice.id },
    basis = {
      before: { ...f.choice, status: "WITHDRAWN" as const },
      product: f.product,
    };
  const request = choiceRetentionRequest(input, basis, randomUUID());
  expect(request.input).toMatchObject({
    expectedVersion: f.choice.version,
    productVersion: f.product.version,
    draft: {
      productId: f.choice.productId,
      source: f.choice.source,
      saleStart: f.choice.saleStart,
      saleEnd: f.choice.saleEnd,
      mechanism: f.choice.mechanism,
      note: f.choice.note,
      status: "RETAINED",
    },
  });
  const assistant = {
    ...chat.message,
    id: randomUUID(),
    storeId: f.choice.storeId,
    role: "ASSISTANT" as const,
    replyToMessageId: chat.message.id,
    attachments: [],
  };
  const preview = {
    input,
    basis,
    status: "READY",
    evidence: [
      {
        id: "retain-again",
        sourceId: f.choice.id,
        sourceVersion: 1,
        sourceType: "DATA_QUALITY",
        label: "Retenir à nouveau",
        value: "À confirmer",
        factKind: "QUALITY",
      },
    ],
  };
  const cards = buildChoiceRetentionProposalMessages(assistant, [preview]);
  expect(buildChoiceRetentionProposalMessages(assistant, [preview])).toEqual(
    cards,
  );
  expect(readCopilotChoiceRetentionProposal(cards[0]).request).toEqual({
    ...request,
    operationId: cards[0]!.id,
  });
  const unchanged = {
    ...preview,
    status: "UNCHANGED",
    basis: { ...basis, before: f.choice },
  };
  expect(copilotChoiceRetentionPreviewSchema.safeParse(unchanged).success).toBe(
    true,
  );
  expect(
    buildChoiceRetentionProposalMessages(assistant, [preview, unchanged]),
  ).toEqual([]);
  expect(() =>
    buildChoiceRetentionProposalMessages(
      { ...assistant, storeId: randomUUID() },
      [preview],
    ),
  ).toThrow("SCOPE");
});
it("rejects model authority/terms/product injection and invalid or already retained review bases", async () => {
  const f = await commercialChoiceFixture(),
    input = { choiceId: f.choice.id },
    basis = {
      before: { ...f.choice, status: "WITHDRAWN" as const },
      product: f.product,
    };
  for (const extra of [
    { storeId: randomUUID() },
    { expectedVersion: 1 },
    { productId: randomUUID() },
    { patch: { note: "injection" } },
    { status: "RETAINED" },
    { criticalFieldsConfirmed: true },
  ])
    expect(
      copilotChoiceRetentionInputSchema.safeParse({ ...input, ...extra })
        .success,
    ).toBe(false);
  for (const b of [
    { ...basis, before: f.choice },
    { ...basis, product: { ...f.product, id: randomUUID() } },
    { ...basis, product: { ...f.product, storeId: randomUUID() } },
    { ...basis, product: { ...f.product, status: "INACTIVE" as const } },
    { ...basis, product: { ...f.product, deletedAt: "2026-10-17T10:00:00Z" } },
  ])
    expect(() => choiceRetentionRequest(input, b, randomUUID())).toThrow();
  expect(
    choiceRetentionBasisSchema.safeParse({
      ...basis,
      before: { ...basis.before, criticalFieldsConfirmed: false },
    }).success,
  ).toBe(false);
});
