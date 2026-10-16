import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { substitutionFixture } from "../../../../scripts/test-substitution-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  copilotNeedProposalInputSchema,
  prepareNeedProposalRequest,
  needProposalUnchanged,
  readCopilotNeedProposal,
} from "@fl-copilot/domain";
import { buildNeedProposalMessages } from "./need-proposal-messages";
const blank = {
  need: null,
  product: null,
  substitute: null,
  membership: null,
  substitution: null,
};
it("rejects writable inspection, invented learned fields, self/reverse targets and model reversal authority", async () => {
  const f = await substitutionFixture();
  const input = {
    kind: "SUBSTITUTION",
    action: "PREPARE",
    needUnitId: f.need.id,
    productId: f.product.id,
    substituteProductId: f.substitute.id,
    patch: { decision: "VALIDATED" },
  };
  for (const extra of [
    { relationshipScore: 1 },
    { allowReactivateRejected: true },
    { observedSubstitution: 1 },
  ])
    expect(
      copilotNeedProposalInputSchema.safeParse({
        ...input,
        patch: { ...input.patch, ...extra },
      }).success,
    ).toBe(false);
  expect(
    copilotNeedProposalInputSchema.safeParse({
      ...input,
      substituteProductId: f.product.id,
    }).success,
  ).toBe(false);
  const basis = {
    ...blank,
    need: f.need,
    product: f.product,
    substitute: f.substitute,
    substitution: f.substitution,
  };
  const parsed = copilotNeedProposalInputSchema.parse(input);
  expect(needProposalUnchanged(parsed, basis)).toBe(true);
  expect(
    prepareNeedProposalRequest(parsed, basis, randomUUID()).input,
  ).toMatchObject({ allowReactivateRejected: false });
  const chat = chatFixture(randomUUID),
    assistant = {
      ...chat.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      storeId: f.need.storeId,
      replyToMessageId: chat.message.id,
      attachments: [],
    };
  const value = {
    input: parsed,
    status: "READY",
    basis,
    missingFields: [],
    evidence: [
      {
        id: "need-preview",
        sourceType: "DATA_QUALITY",
        sourceId: f.need.id,
        sourceVersion: 1,
        label: "Relation",
        value: "À confirmer.",
        factKind: "QUALITY",
      },
    ],
  };
  const cards = buildNeedProposalMessages(assistant, [value, value]);
  expect(cards).toHaveLength(1);
  expect(buildNeedProposalMessages(assistant, [value])).toEqual(cards);
  expect(readCopilotNeedProposal(cards[0]).request.tool).toBe(
    "substitution.save",
  );
  expect(
    buildNeedProposalMessages(assistant, [
      value,
      { ...value, status: "UNCHANGED" },
    ]),
  ).toEqual([]);
  expect(() =>
    buildNeedProposalMessages(assistant, [
      {
        ...value,
        basis: { ...basis, need: { ...f.need, storeId: randomUUID() } },
      },
    ]),
  ).toThrow();
  expect(() =>
    readCopilotNeedProposal({
      ...cards[0]!,
      text: cards[0]!.text.replace(f.substitute.id, randomUUID()),
    }),
  ).toThrow();
});
it("preserves unrequested existing levels and code and requires missing new levels instead of inventing them", async () => {
  const f = await substitutionFixture(),
    basis = { ...blank, need: f.need };
  const rename = copilotNeedProposalInputSchema.parse({
    kind: "NEED",
    action: "PREPARE",
    needUnitId: f.need.id,
    patch: { name: "Autre nom" },
  });
  expect(
    prepareNeedProposalRequest(rename, basis, randomUUID()).input,
  ).toMatchObject({
    code: f.need.code,
    description: f.need.description,
    status: f.need.status,
  });
  const create = copilotNeedProposalInputSchema.parse({
    kind: "NEED",
    action: "PREPARE",
    needUnitId: null,
    patch: { name: "Repas d’été" },
  });
  expect(
    prepareNeedProposalRequest(create, blank, randomUUID()).input,
  ).toMatchObject({ code: "REPAS_D_ETE", status: "ACTIVE" });
  expect(() =>
    prepareNeedProposalRequest(
      copilotNeedProposalInputSchema.parse({
        kind: "MEMBERSHIP",
        action: "PREPARE",
        needUnitId: f.need.id,
        productId: f.product.id,
        patch: { decision: "VALIDATED" },
      }),
      { ...basis, product: f.product },
      randomUUID(),
    ),
  ).toThrow();
});

it("supports a requested new need code but never changes a reserved existing identity", async () => {
  const f = await substitutionFixture();
  const create = copilotNeedProposalInputSchema.parse({
    kind: "NEED",
    action: "PREPARE",
    needUnitId: null,
    patch: { name: "Repas", code: "REPAS_CLIENT" },
  });
  expect(
    prepareNeedProposalRequest(create, blank, randomUUID()).input,
  ).toMatchObject({ code: "REPAS_CLIENT" });
  const changed = copilotNeedProposalInputSchema.parse({
    kind: "NEED",
    action: "PREPARE",
    needUnitId: f.need.id,
    patch: { code: "AUTRE_CODE" },
  });
  expect(() =>
    prepareNeedProposalRequest(
      changed,
      { ...blank, need: f.need },
      randomUUID(),
    ),
  ).toThrow("CODE_IMMUTABLE");
});
