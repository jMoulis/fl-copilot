import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import {
  copilotPlanValidationPreviewSchema,
  readCopilotPlanValidationProposal,
} from "@fl-copilot/domain";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
it("binds complete plan candidate scope, week and next version to a private card", async () => {
  const f = await commercialPlanFixture(),
    chat = chatFixture(randomUUID),
    preview = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "commercial.plan.preview",
      status: "COMPLETED",
      observedAt: f.plan.validatedAt,
      message: "Aperçu",
      expectedPlanVersion: null,
      candidate: f.plan,
      issues: [],
    },
    evidence = [
      {
        id: "plan-test",
        sourceType: "DATA_QUALITY",
        sourceId: f.storeId,
        sourceVersion: null,
        label: "Plan",
        value: "Revue",
        factKind: "QUALITY",
      },
    ],
    value = {
      storeId: f.storeId,
      input: { weekStart: f.preparation.weekStart },
      status: "READY",
      preview,
      issues: [],
      evidence,
    };
  expect(
    copilotPlanValidationPreviewSchema.parse(value).preview?.candidate,
  ).toEqual(f.plan);
  for (const invalid of [
    { ...value, storeId: randomUUID() },
    { ...value, input: { weekStart: "2026-10-12" } },
    { ...value, preview: { ...preview, expectedPlanVersion: 2 } },
    { ...value, status: "UNCHANGED" },
    { ...value, input: { ...value.input, manager: true } },
  ])
    expect(copilotPlanValidationPreviewSchema.safeParse(invalid).success).toBe(
      false,
    );
  const message = {
    ...chat.message,
    storeId: f.storeId,
    role: "TOOL",
    replyToMessageId: chat.message.id,
    id: randomUUID(),
    attachments: [],
    text: JSON.stringify({
      kind: "PLAN_VALIDATION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: randomUUID(),
      preview,
    }),
  };
  expect(
    readCopilotPlanValidationProposal(message).request.input.previewOperationId,
  ).toBe(preview.operationId);
  expect(() =>
    readCopilotPlanValidationProposal({ ...message, storeId: randomUUID() }),
  ).toThrow("SCOPE");
  expect(() =>
    readCopilotPlanValidationProposal({ ...message, role: "USER" }),
  ).toThrow("INVALID");
});
