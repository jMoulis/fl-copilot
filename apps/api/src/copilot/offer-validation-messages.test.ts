import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { offerValidationPreviewFixture } from "../../../../scripts/test-offer-validation-preview-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  copilotOfferValidationInputSchema,
  offerValidationPreviewRequest,
  offerValidationReviewedSources,
  readCopilotOfferValidationProposal,
} from "@fl-copilot/domain";
import { buildOfferValidationProposalMessages } from "./offer-validation-messages";
it("binds exact selection versions and sources without model authority, and keeps only the final batch proposal", async () => {
  const { f, input, basis } = await offerValidationPreviewFixture(),
    chat = chatFixture(randomUUID),
    assistant = {
      ...chat.message,
      id: randomUUID(),
      storeId: f.storeId,
      role: "ASSISTANT" as const,
      replyToMessageId: chat.message.id,
      attachments: [],
    },
    request = offerValidationPreviewRequest(input, basis, randomUUID()),
    preview = {
      storeId: f.storeId,
      input,
      status: "READY",
      basis,
      alreadyValidatedIds: [],
      issue: null,
      evidence: [
        {
          id: "validation",
          sourceType: "DATA_QUALITY",
          sourceId: f.storeId,
          sourceVersion: null,
          label: "À valider",
          value: "Revue requise",
          factKind: "QUALITY",
        },
      ],
    };
  expect(request.input.selection).toEqual([
    {
      choiceId: f.choice.id,
      choiceVersion: f.choice.version,
      productVersion: f.product.version,
    },
  ]);
  expect(offerValidationReviewedSources(basis)).toEqual([
    {
      choiceId: f.choice.id,
      choiceVersion: f.choice.version,
      readingId: f.readingId,
      checksum: f.reading.checksum,
    },
  ]);
  const cards = buildOfferValidationProposalMessages(assistant, [
    preview,
    preview,
  ]);
  expect(cards).toHaveLength(1);
  expect(buildOfferValidationProposalMessages(assistant, [preview])).toEqual(
    cards,
  );
  expect(readCopilotOfferValidationProposal(cards[0]).request).toEqual({
    ...request,
    operationId: cards[0]!.id,
  });
  expect(
    buildOfferValidationProposalMessages(assistant, [
      preview,
      {
        ...preview,
        status: "UNCHANGED",
        basis: null,
        alreadyValidatedIds: input.choiceIds,
      },
    ]),
  ).toEqual([]);
  expect(() =>
    buildOfferValidationProposalMessages(
      { ...assistant, storeId: randomUUID() },
      [preview],
    ),
  ).toThrow("SCOPE");
});
it("rejects oversized/duplicate selection, scope/version/review injection and mismatched source/product basis", async () => {
  const { input, basis } = await offerValidationPreviewFixture();
  for (const extra of [
    { choiceIds: [] },
    { choiceIds: [input.choiceIds[0], input.choiceIds[0]] },
    { choiceIds: Array.from({ length: 26 }, () => randomUUID()) },
    { storeId: randomUUID() },
    {
      selection: [
        { choiceId: input.choiceIds[0], choiceVersion: 1, productVersion: 1 },
      ],
    },
    { reviewedSources: [] },
    { sourceReviewed: true },
  ])
    expect(
      copilotOfferValidationInputSchema.safeParse({ ...input, ...extra })
        .success,
    ).toBe(false);
  const entry = basis.entries[0]!;
  for (const e of [
    { ...entry, choice: { ...entry.choice, status: "WITHDRAWN" as const } },
    { ...entry, product: { ...entry.product, storeId: randomUUID() } },
    { ...entry, product: { ...entry.product, status: "INACTIVE" as const } },
    { ...entry, offer: { ...entry.offer, rawProductLabel: "Wrong source" } },
  ])
    expect(() =>
      offerValidationPreviewRequest(
        input,
        { ...basis, entries: [e] },
        randomUUID(),
      ),
    ).toThrow();
});
