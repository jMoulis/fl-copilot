import { it, expect } from "vitest";
import {
  commercialVersionDecisionId,
  commercialVersionDecisionSourcesValid,
} from "./version-decision";
import type { CommercialVersionDecision } from "@fl-copilot/domain";
it("identifies the pair consistently while requiring complete, tenant-scoped immutable snapshots", async () => {
  const storeId = "00000000-0000-4000-8000-000000000001",
    beforeId = "00000000-0000-4000-8000-000000000002",
    afterId = "00000000-0000-4000-8000-000000000003",
    readingId = "00000000-0000-4000-8000-000000000004",
    otherId = "00000000-0000-4000-8000-000000000005";
  const digests: string[] = [];
  const digest = async (s: string) => {
    digests.push(s);
    return "a".repeat(64);
  };
  expect(
    await commercialVersionDecisionId(storeId, beforeId, afterId, digest),
  ).toBe(await commercialVersionDecisionId(storeId, afterId, beforeId, digest));
  expect(digests[0]).toBe(digests[1]);
  const d: CommercialVersionDecision = {
    id: beforeId,
    storeId,
    before: { documentId: beforeId, checksum: "old", readingIds: [readingId] },
    after: { documentId: afterId, checksum: "new", readingIds: [otherId] },
    preference: "KEEP_PREVIOUS",
    comparisonReviewed: true,
    note: "",
    version: 1,
    createdAt: "2026-10-08T12:00:00Z",
    updatedAt: "2026-10-08T12:00:00Z",
  };
  const before = {
      id: readingId,
      storeId,
      sourceDocumentId: beforeId,
      checksum: "old",
      pageNumber: 1,
      pageCount: 1,
      status: "READY",
      model: "test",
      schemaVersion: "test",
      reading: {
        operations: [],
        tgIdeas: [],
        otherInformation: [],
        warnings: [],
      },
    },
    after = {
      ...before,
      id: otherId,
      sourceDocumentId: afterId,
      checksum: "new",
    };
  expect(commercialVersionDecisionSourcesValid(d, [before, after])).toBe(true);
  expect(
    commercialVersionDecisionSourcesValid(d, [
      { ...before, pageCount: 2 },
      after,
    ]),
  ).toBe(false);
  expect(
    commercialVersionDecisionSourcesValid(d, [
      { ...before, storeId: afterId },
      after,
    ]),
  ).toBe(false);
});
