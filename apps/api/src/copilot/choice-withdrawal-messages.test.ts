import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { commercialChoiceFixture } from "../../../../scripts/test-commercial-choice-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  copilotChoiceWithdrawalInputSchema,
  readCopilotChoiceWithdrawalProposal,
} from "@fl-copilot/domain";
import { buildChoiceWithdrawalProposalMessages } from "./choice-withdrawal-messages";
it("binds a stable private withdrawal to the exact retained terms without model authority", async () => {
  const f = await commercialChoiceFixture(),
    c = chatFixture(randomUUID);
  const assistant = {
    ...c.message,
    storeId: f.choice.storeId,
    role: "ASSISTANT" as const,
    id: randomUUID(),
    replyToMessageId: c.message.id,
    attachments: [],
  };
  const preview = {
    input: { choiceId: f.choice.id },
    before: f.choice,
    status: "READY",
    evidence: [
      {
        id: "withdraw",
        sourceType: "DATA_QUALITY",
        sourceId: f.choice.id,
        sourceVersion: 1,
        label: "Retrait",
        value: "À confirmer",
        factKind: "QUALITY",
      },
    ],
  };
  const cards = buildChoiceWithdrawalProposalMessages(assistant, [preview]);
  expect(buildChoiceWithdrawalProposalMessages(assistant, [preview])).toEqual(
    cards,
  );
  const { request } = readCopilotChoiceWithdrawalProposal(cards[0]);
  expect(request.input.expectedVersion).toBe(1);
  expect(request.input.productVersion).toBeNull();
  expect(request.input.draft).toMatchObject({
    source: f.choice.source,
    productId: f.choice.productId,
    mechanism: f.choice.mechanism,
    note: f.choice.note,
    status: "WITHDRAWN",
  });
  for (const extra of [
    { storeId: randomUUID() },
    { expectedVersion: 2 },
    { status: "RETAINED" },
    { sourceReviewed: true },
  ])
    expect(
      copilotChoiceWithdrawalInputSchema.safeParse({
        choiceId: f.choice.id,
        ...extra,
      }).success,
    ).toBe(false);
  expect(
    buildChoiceWithdrawalProposalMessages(assistant, [
      preview,
      {
        ...preview,
        status: "UNCHANGED",
        before: { ...f.choice, status: "WITHDRAWN" },
      },
    ]),
  ).toEqual([]);
  expect(() =>
    buildChoiceWithdrawalProposalMessages(
      { ...assistant, storeId: randomUUID() },
      [preview],
    ),
  ).toThrow("SCOPE");
  expect(() =>
    readCopilotChoiceWithdrawalProposal({ ...cards[0], role: "ASSISTANT" }),
  ).toThrow();
});
