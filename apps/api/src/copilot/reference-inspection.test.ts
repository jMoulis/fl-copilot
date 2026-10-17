import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import {
  copilotReferenceInspectionInputSchema,
  validateReferenceInspectionResult,
} from "@fl-copilot/domain";
import { referenceInspectionFixture } from "../../../../scripts/test-reference-inspection-fixtures";
it("reads either query order without reversing the canonical decision", async () => {
  const f = await referenceInspectionFixture();
  const input = {
    firstDocumentId: f.inspectInput.secondDocumentId,
    secondDocumentId: f.inspectInput.firstDocumentId,
  };
  const r = validateReferenceInspectionResult(f.f.storeId, input, {
    ...f.result,
    input,
    first: f.result.second,
    second: f.result.first,
  });
  expect(r.decision).toEqual(f.decision);
  expect(
    copilotReferenceInspectionInputSchema.safeParse({
      ...input,
      storeId: f.f.storeId,
    }).success,
  ).toBe(false);
  expect(
    copilotReferenceInspectionInputSchema.safeParse({
      ...input,
      secondDocumentId: input.firstDocumentId,
    }).success,
  ).toBe(false);
});
it("rejects foreign stores, source pairs, evidence, mismatched requests and invalid result states", async () => {
  const f = await referenceInspectionFixture();
  const bad = [
    { ...f.result, storeId: randomUUID() },
    { ...f.result, decision: { ...f.decision, storeId: randomUUID() } },
    {
      ...f.result,
      decision: {
        ...f.decision,
        before: { ...f.decision.before, documentId: randomUUID() },
      },
    },
    {
      ...f.result,
      input: { ...f.inspectInput, firstDocumentId: randomUUID() },
    },
    {
      ...f.result,
      evidence: f.result.evidence.map((e) => ({
        ...e,
        sourceId: randomUUID(),
      })),
    },
    { ...f.result, first: { ...f.result.first, documentId: randomUUID() } },
    { ...f.result, status: "NO_DECISION" },
    { ...f.result, reviewStatus: null },
    { ...f.result, first: null },
    { ...f.result, first: { ...f.result.first, checksum: "changed" } },
  ];
  for (const r of bad)
    expect(() =>
      validateReferenceInspectionResult(f.f.storeId, f.inspectInput, r),
    ).toThrow();
});
it("keeps absent, unavailable and historical-unverified states distinct", async () => {
  const f = await referenceInspectionFixture();
  for (const r of [
    { ...f.result, status: "NO_DECISION", decision: null, reviewStatus: null },
    {
      ...f.result,
      status: "UNAVAILABLE",
      first: null,
      decision: null,
      reviewStatus: null,
    },
    {
      ...f.result,
      status: "LIMIT_EXCEEDED",
      decision: null,
      reviewStatus: null,
    },
    {
      ...f.result,
      reviewStatus: "REVIEW_REQUIRED",
      first: { ...f.result.first, checksum: "changed" },
    },
    { ...f.result, reviewStatus: "LIMIT_EXCEEDED" },
  ])
    expect(
      validateReferenceInspectionResult(f.f.storeId, f.inspectInput, r),
    ).toMatchObject({ status: r.status, reviewStatus: r.reviewStatus });
});
