import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { sourceOffersFixture } from "../../../../scripts/test-source-offers-fixtures";
import {
  copilotSourceOffersInputSchema,
  validateSourceOffersResult,
} from "@fl-copilot/domain";

it("accepts bounded explicit source inspection without identity or write authority arguments", async () => {
  const { f, input, result } = await sourceOffersFixture();
  expect(validateSourceOffersResult(f.storeId, input, result)).toEqual(result);
  for (const extra of [
    { storeId: randomUUID() },
    { save: true },
    { limit: 6 },
    { offset: -1 },
    { businessDate: "2026-02-30" },
    { pageNumber: 0 },
    { choiceId: randomUUID() },
  ])
    expect(
      copilotSourceOffersInputSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
});
it("rejects mismatched source coordinates, scope, pagination, readiness and lost warning coverage", async () => {
  const { f, input, result } = await sourceOffersFixture(),
    offer = result.offers[0]!;
  for (const patch of [
    { storeId: randomUUID() },
    { evidence: [{ ...result.evidence[0]!, sourceId: randomUUID() }] },
    { input: { ...input, pageNumber: 2 } },
    { readingId: randomUUID() },
    { checksum: "changed" },
    {
      offers: [
        {
          ...offer,
          source: { ...offer.source, sourceDocumentId: randomUUID() },
        },
      ],
    },
    { offers: [{ ...offer, pageNumber: 2 }] },
    { offers: [offer, offer] },
    { nextOffset: 0 },
    { nextOffset: 2 },
    { status: "NOT_READY" },
    { totalOffers: 2 },
    { warningCount: 1 },
    { warningsComplete: false },
    { offers: [{ ...offer, validationStatus: "VALIDATED" }] },
  ])
    expect(() =>
      validateSourceOffersResult(f.storeId, input, { ...result, ...patch }),
    ).toThrow();
  expect(
    validateSourceOffersResult(
      f.storeId,
      { ...input, offset: 2 },
      { ...result, input: { ...input, offset: 2 }, offers: [] },
    ).offers,
  ).toEqual([]);
});
