import { expect, it } from "vitest";
import {
  copilotPlanReadinessInputSchema,
  copilotPlanReadinessResultSchema,
  validatePlanReadinessResult,
} from "./copilot-plan-readiness";
const storeId = "00000000-0000-4000-8000-000000000001",
  input = { weekStart: "2026-10-05" };
const value = {
  storeId,
  ...input,
  status: "NO_DRAFT",
  preparation: null,
  issues: [],
  evidence: [
    {
      id: "readiness/test",
      sourceType: "DATA_QUALITY",
      sourceId: storeId,
      sourceVersion: null,
      label: "Plan",
      value: "Absent",
      factKind: "QUALITY",
    },
  ],
};
it("requires an explicit Monday and never accepts injected authority", () => {
  expect(
    copilotPlanReadinessInputSchema.safeParse({ weekStart: "2026-10-06" })
      .success,
  ).toBe(false);
  expect(
    copilotPlanReadinessInputSchema.safeParse({ ...input, storeId }).success,
  ).toBe(false);
  expect(
    copilotPlanReadinessResultSchema.safeParse({ ...value, status: "READY" })
      .success,
  ).toBe(false);
  expect(validatePlanReadinessResult(storeId, input, value).status).toBe(
    "NO_DRAFT",
  );
  expect(() =>
    validatePlanReadinessResult(
      "00000000-0000-4000-8000-000000000002",
      input,
      value,
    ),
  ).toThrow("SCOPE");
  expect(() =>
    validatePlanReadinessResult(storeId, { weekStart: "2026-10-12" }, value),
  ).toThrow("SCOPE");
});
