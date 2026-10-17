import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { commercialChoiceFixture } from "../../../../scripts/test-commercial-choice-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  choiceReassociationRequest,
  copilotChoiceReassociationInputSchema,
  copilotChoiceReassociationPreviewSchema,
  readCopilotChoiceReassociationProposal,
} from "@fl-copilot/domain";
import { buildChoiceReassociationProposalMessages } from "./choice-reassociation-messages";
it("binds a stable explicit reassociation review, preserving every commercial condition and allowing a missing old profile", async () => {
  const f = await commercialChoiceFixture(),
    chat = chatFixture(randomUUID),
    target = { ...f.product, id: randomUUID(), label: "Produit cible" },
    input = { choiceId: f.choice.id, productId: target.id },
    basis = { before: f.choice, product: target, previousProduct: null };
  const request = choiceReassociationRequest(input, basis, randomUUID());
  expect(request.input).toMatchObject({
    expectedVersion: f.choice.version,
    productVersion: target.version,
    draft: {
      productId: target.id,
      source: f.choice.source,
      mechanism: f.choice.mechanism,
      saleStart: f.choice.saleStart,
      saleEnd: f.choice.saleEnd,
      note: f.choice.note,
      status: f.choice.status,
    },
  });
  const assistant = {
    ...chat.message,
    storeId: f.choice.storeId,
    id: randomUUID(),
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
        id: "associate",
        sourceId: f.choice.id,
        sourceVersion: 1,
        sourceType: "DATA_QUALITY",
        factKind: "QUALITY",
        label: "Association",
        value: "À confirmer",
      },
    ],
  };
  const cards = buildChoiceReassociationProposalMessages(assistant, [preview]);
  expect(
    buildChoiceReassociationProposalMessages(assistant, [preview]),
  ).toEqual(cards);
  expect(readCopilotChoiceReassociationProposal(cards[0]).request).toEqual({
    ...request,
    operationId: cards[0]!.id,
  });
  expect(() =>
    buildChoiceReassociationProposalMessages(
      { ...assistant, storeId: randomUUID() },
      [preview],
    ),
  ).toThrow("SCOPE");
  expect(
    buildChoiceReassociationProposalMessages(assistant, [
      preview,
      {
        ...preview,
        status: "UNCHANGED",
        input: { ...input, productId: f.product.id },
        basis: { ...basis, product: f.product },
      },
    ]),
  ).toEqual([]);
});
it("rejects scope/identity/status/authority injection and inconsistent old or target product snapshots", async () => {
  const f = await commercialChoiceFixture(),
    target = { ...f.product, id: randomUUID() },
    input = { choiceId: f.choice.id, productId: target.id },
    basis = { before: f.choice, product: target, previousProduct: f.product };
  for (const extra of [
    { patch: { note: "injection" } },
    { storeId: randomUUID() },
    { expectedVersion: 1 },
    { decisionLevel: "REVIEWED" },
    { source: f.choice.source },
    { status: "RETAINED" },
  ])
    expect(
      copilotChoiceReassociationInputSchema.safeParse({ ...input, ...extra })
        .success,
    ).toBe(false);
  for (const b of [
    { ...basis, before: { ...f.choice, status: "WITHDRAWN" as const } },
    { ...basis, product: { ...target, id: randomUUID() } },
    { ...basis, product: { ...target, storeId: randomUUID() } },
    { ...basis, product: { ...target, status: "INACTIVE" as const } },
    { ...basis, previousProduct: { ...f.product, id: randomUUID() } },
    { ...basis, previousProduct: { ...f.product, storeId: randomUUID() } },
  ])
    expect(() => choiceReassociationRequest(input, b, randomUUID())).toThrow();
  expect(
    copilotChoiceReassociationPreviewSchema.safeParse({
      input,
      basis,
      status: "UNCHANGED",
      evidence: [],
    }).success,
  ).toBe(false);
});
