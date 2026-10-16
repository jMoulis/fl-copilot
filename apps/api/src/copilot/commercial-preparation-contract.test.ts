import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import {
  copilotPreparationReadInputSchema,
  validatePreparationReadResult,
} from "@fl-copilot/domain";
it("accepts only explicit Monday and bounded pages, with no scope or write arguments", () => {
  const valid = { weekStart: "2026-10-05", offset: 0, limit: 10 };
  expect(copilotPreparationReadInputSchema.parse(valid)).toEqual(valid);
  for (const patch of [
    { weekStart: "2026-10-06" },
    { weekStart: "2026-02-30" },
    { limit: 11 },
    { offset: -1 },
    { storeId: randomUUID() },
    { save: true },
  ])
    expect(
      copilotPreparationReadInputSchema.safeParse({ ...valid, ...patch })
        .success,
    ).toBe(false);
});
it("rejects inconsistent scope, page coverage, result state and duplicate returned identities", async () => {
  const f = await commercialPlanFixture(),
    input = { weekStart: f.preparation.weekStart, offset: 0, limit: 10 };
  const r = {
    weekStart: input.weekStart,
    status: "DRAFT",
    preparation: f.preparation,
    choices: [f.choice],
    missingChoiceIds: [],
    issues: [],
    nextOffset: null,
    evidence: [
      {
        id: "preparation",
        sourceId: f.preparation.id,
        sourceType: "COMMERCIAL_OPERATION",
        sourceVersion: 1,
        label: "Brouillon",
        value: "Préparation seulement",
        factKind: "PLANNED",
      },
    ],
  };
  expect(
    validatePreparationReadResult(f.storeId, input, r).preparation,
  ).toEqual(f.preparation);
  for (const patch of [
    { status: "NO_DRAFT" },
    { weekStart: "2026-10-12" },
    { choices: [] },
    { choices: [f.choice, f.choice] },
    { missingChoiceIds: [f.choice.id] },
    { nextOffset: 1 },
    { issues: [{ choiceId: randomUUID(), code: "MISSING" }] },
    { choices: [{ ...f.choice, storeId: randomUUID() }] },
    { preparation: { ...f.preparation, storeId: randomUUID() } },
  ])
    expect(() =>
      validatePreparationReadResult(f.storeId, input, { ...r, ...patch }),
    ).toThrow();
});
