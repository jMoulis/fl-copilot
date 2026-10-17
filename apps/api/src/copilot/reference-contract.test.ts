import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { referencePreviewFixture } from "../../../../scripts/test-reference-preview-fixtures";
import {
  copilotReferenceInputSchema,
  copilotReferencePreviewSchema,
  referenceSaveRequestSchema,
  referenceDesiredValue,
  readCopilotReferenceProposal,
} from "@fl-copilot/domain";
import { buildReferenceProposalMessages } from "./reference-messages";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
it("keeps explicit pair/preference/note authority separate from immutable scoped basis", async () => {
  const f = await referencePreviewFixture(true);
  expect(referenceDesiredValue(f.input, f.basis).note).toBe(f.decision.note);
  expect(referenceDesiredValue({ ...f.input, note: "" }, f.basis).note).toBe(
    "",
  );
  for (const input of [
    { ...f.input, storeId: randomUUID() },
    { ...f.input, comparisonReviewed: true },
    { ...f.input, afterDocumentId: f.input.beforeDocumentId },
    { ...f.input, version: 2 },
  ])
    expect(copilotReferenceInputSchema.safeParse(input).success).toBe(false);
  expect(() =>
    referenceDesiredValue(f.input, { ...f.basis, storeId: randomUUID() }),
  ).toThrow("SCOPE");
  expect(() =>
    referenceDesiredValue(
      {
        ...f.input,
        beforeDocumentId: f.input.afterDocumentId,
        afterDocumentId: f.input.beforeDocumentId,
      },
      f.basis,
    ),
  ).toThrow("SCOPE");
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.reference.save",
    input: { intent: f.input, basis: f.basis },
  };
  expect(
    referenceSaveRequestSchema.parse(request).input.basis.previous,
  ).toEqual(f.decision);
  expect(
    referenceSaveRequestSchema.safeParse({
      ...request,
      input: {
        ...request.input,
        intent: { ...f.input, preference: "KEEP_PREVIOUS" },
      },
    }).success,
  ).toBe(false);
});
it("emits only the latest complete private proposal and rejects foreign, unchanged and malformed reviews", async () => {
  const f = await referencePreviewFixture(),
    chat = chatFixture(randomUUID),
    assistant = {
      ...chat.message,
      storeId: f.f.storeId,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      attachments: [],
      replyToMessageId: chat.message.id,
      text: "Choix à revoir.",
    };
  const preview = copilotReferencePreviewSchema.parse({
    storeId: f.f.storeId,
    input: f.input,
    status: "READY",
    basis: f.basis,
    issue: null,
    evidence: [
      {
        id: "reference/test",
        sourceId: f.f.storeId,
        sourceType: "DATA_QUALITY",
        sourceVersion: null,
        label: "Référence",
        value: "Revue",
        factKind: "QUALITY",
      },
    ],
  });
  const cards = buildReferenceProposalMessages(assistant, [preview]);
  expect(cards).toHaveLength(1);
  const parsed = readCopilotReferenceProposal(cards[0]);
  expect(parsed.content.basis).toEqual(f.basis);
  expect(parsed.content.assistantMessageId).toBe(assistant.id);
  expect(buildReferenceProposalMessages(assistant, [preview])).toEqual(cards);
  const unchanged = { ...preview, status: "UNCHANGED", basis: null };
  expect(
    buildReferenceProposalMessages(assistant, [preview, unchanged]),
  ).toEqual([]);
  expect(() =>
    buildReferenceProposalMessages({ ...assistant, storeId: randomUUID() }, [
      preview,
    ]),
  ).toThrow("SCOPE");
  expect(() =>
    readCopilotReferenceProposal({ ...cards[0], storeId: randomUUID() }),
  ).toThrow("SCOPE");
  expect(
    copilotReferencePreviewSchema.safeParse({ ...preview, status: "BLOCKED" })
      .success,
  ).toBe(false);
});
