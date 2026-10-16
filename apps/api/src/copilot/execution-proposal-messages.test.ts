import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { commercialExecutionFixture } from "../../../../scripts/test-commercial-execution-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  copilotExecutionPreviewInputSchema,
  copilotExecutionPreviewResultSchema,
  readCopilotExecutionProposal,
} from "@fl-copilot/domain";
import { buildExecutionProposalMessages } from "./execution-proposal-messages";
async function fixture() {
  const f = await commercialExecutionFixture(),
    chat = chatFixture(randomUUID);
  const assistant = {
    ...chat.message,
    id: randomUUID(),
    storeId: f.storeId,
    role: "ASSISTANT" as const,
    replyToMessageId: chat.message.id,
    text: "Déclaration préparée.",
    attachments: [],
  };
  const result = copilotExecutionPreviewResultSchema.parse({
    input: {
      weekStart: f.plan.weekStart,
      taskId: f.proposals[0]!.id,
      status: "DONE",
      note: "Affiche imprimée",
    },
    status: "READY",
    preview: { proposal: f.proposals[0], before: null },
    evidence: [
      {
        id: "execution-preview",
        sourceId: f.proposals[0]!.id,
        sourceVersion: f.plan.version,
        sourceType: "COMMERCIAL_OPERATION",
        label: "Déclaration préparée",
        value: "Aucun enregistrement effectué.",
        factKind: "PLANNED",
      },
    ],
  });
  return { f, assistant, result };
}
it("builds stable private execution cards once, binding the exact preview and preserving their review-only role", async () => {
  const { assistant, result } = await fixture();
  const [first] = buildExecutionProposalMessages(assistant, [result, result]);
  expect(buildExecutionProposalMessages(assistant, [result])[0]).toEqual(first);
  const parsed = readCopilotExecutionProposal(first);
  expect(parsed.message).toMatchObject({
    role: "TOOL",
    ownerId: assistant.ownerId,
    replyToMessageId: assistant.replyToMessageId,
  });
  expect(parsed.content).toMatchObject({
    assistantMessageId: assistant.id,
    proposal: result.preview!.proposal,
    input: result.input,
    before: null,
  });
  expect(first!.text.length).toBeLessThan(16000);
});
it("refuses invented target identity, foreign scope, missing reasons, non-Mondays and injected authority", async () => {
  const { assistant, result, f } = await fixture();
  for (const input of [
    { ...result.input, canDeclareCommercialExecution: true },
    { ...result.input, status: "SKIPPED", note: "" },
    { ...result.input, weekStart: "2026-10-06" },
  ])
    expect(copilotExecutionPreviewInputSchema.safeParse(input).success).toBe(
      false,
    );
  expect(() =>
    buildExecutionProposalMessages({ ...assistant, storeId: randomUUID() }, [
      result,
    ]),
  ).toThrow("SCOPE_INVALID");
  expect(() =>
    buildExecutionProposalMessages(assistant, [
      { ...result, input: { ...result.input, taskId: randomUUID() } },
    ]),
  ).toThrow();
  expect(() =>
    buildExecutionProposalMessages(assistant, [
      {
        ...result,
        preview: {
          proposal: result.preview!.proposal,
          before: { ...f.task, label: "Wrong target" },
        },
      },
    ]),
  ).toThrow();
});
it("suppresses unchanged/unavailable previews and uses the latest result for a task", async () => {
  const { assistant, result, f } = await fixture();
  const unchanged = {
    ...result,
    input: { ...result.input, status: f.task.status, note: f.task.note },
    status: "UNCHANGED",
    preview: { proposal: result.preview!.proposal, before: f.task },
  };
  expect(
    buildExecutionProposalMessages(assistant, [result, unchanged]),
  ).toEqual([]);
  expect(
    buildExecutionProposalMessages(assistant, [
      { ...result, status: "TASK_UNAVAILABLE", preview: null },
    ]),
  ).toEqual([]);
});
