import { it, expect } from "vitest";
import {
  copilotDocumentComparisonInputSchema,
  validateDocumentComparisonResult,
} from "./copilot-document-comparison";
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002",
  storeId = "00000000-0000-4000-8000-000000000003";
const input = {
  beforeDocumentId: a,
  afterDocumentId: b,
  businessDate: "2026-10-08",
  offset: 0,
  limit: 1,
};
const metadata = (documentId: string) => ({
  documentId,
  filename: "Original.pdf",
  checksum: documentId,
  coverage: null,
  period: null,
  warningCount: 0,
});
const result = {
  storeId,
  input,
  week: {
    date: input.businessDate,
    year: 2026,
    number: 41,
    start: "2026-10-05",
    end: "2026-10-11",
  },
  status: "NOT_READY",
  before: metadata(a),
  after: metadata(b),
  counts: null,
  differenceCount: null,
  differences: [],
  nextOffset: null,
  evidence: [
    {
      id: "comparison/quality",
      sourceId: b,
      sourceType: "DATA_QUALITY",
      sourceVersion: null,
      label: "Comparaison",
      value: "Lecture indisponible",
      factKind: "QUALITY",
    },
  ],
};
it("requires distinct exact sources and rejects injected scope, dates and mutation flags", () => {
  expect(
    copilotDocumentComparisonInputSchema.safeParse({
      ...input,
      afterDocumentId: a,
    }).success,
  ).toBe(false);
  expect(
    copilotDocumentComparisonInputSchema.safeParse({
      ...input,
      businessDate: "2026-02-30",
    }).success,
  ).toBe(false);
  expect(
    copilotDocumentComparisonInputSchema.safeParse({
      ...input,
      storeId,
      apply: true,
    }).success,
  ).toBe(false);
  expect(validateDocumentComparisonResult(storeId, input, result)).toEqual(
    result,
  );
  for (const bad of [
    { ...result, storeId: a },
    { ...result, input: { ...input, offset: 1 } },
    { ...result, before: metadata(b) },
    { ...result, evidence: [{ ...result.evidence[0], sourceId: storeId }] },
    { ...result, status: "SAME_BINARY" },
    { ...result, status: "COMPARED" },
    { ...result, differenceCount: 0 },
    { ...result, status: "UNAVAILABLE" },
  ])
    expect(() =>
      validateDocumentComparisonResult(storeId, input, bad),
    ).toThrow();
});
it("rejects incomplete pagination and inconsistent comparison counts", () => {
  const complete = {
    ...result,
    status: "COMPARED",
    before: {
      ...metadata(a),
      coverage: { complete: true, ready: 1, total: 1 },
      period: { included: 0, excluded: 0, unknown: 0 },
    },
    after: {
      ...metadata(b),
      coverage: { complete: true, ready: 1, total: 1 },
      period: { included: 0, excluded: 0, unknown: 0 },
    },
    counts: {
      CHANGED: 0,
      UNCHANGED: 0,
      NOT_FOUND_IN_NEW: 0,
      NEW_IN_READING: 0,
      AMBIGUOUS: 0,
    },
    differenceCount: 0,
  };
  expect(
    validateDocumentComparisonResult(storeId, input, complete).status,
  ).toBe("COMPARED");
  expect(() =>
    validateDocumentComparisonResult(storeId, input, {
      ...complete,
      counts: { ...complete.counts, CHANGED: 1 },
    }),
  ).toThrow();
  expect(() =>
    validateDocumentComparisonResult(storeId, input, {
      ...complete,
      nextOffset: 1,
    }),
  ).toThrow();
  expect(() =>
    validateDocumentComparisonResult(storeId, input, {
      ...complete,
      status: "INCOMPLETE",
    }),
  ).toThrow();
});
