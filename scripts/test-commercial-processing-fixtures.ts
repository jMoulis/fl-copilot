let fixtureId = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++fixtureId).padStart(12, "0")}`;
import {
  COMMERCIAL_AI_SCHEMA_VERSION,
  COMMERCIAL_VISUAL_SCHEMA_VERSION,
} from "../packages/domain/src/index";
import type { CommercialProcessingReview } from "../packages/sync-contracts/src/index";
import type { ProcessingSnapshot } from "../apps/api/src/commercial/processing-recovery-policy";
export const processingTime = new Date("2026-10-18T12:00:00.000Z");
export function commercialProcessingFixture(): ProcessingSnapshot {
  const id = randomUUID(),
    storeId = randomUUID(),
    checksum = `sha256:${"a".repeat(64)}`;
  return {
    source: { _id: id, storeId, checksum, objectKey: "private/original.pdf" },
    job: {
      _id: id,
      storeId,
      sourceDocumentId: id,
      checksum,
      objectKey: "private/original.pdf",
      pipelineVersion: "commercial-pdf.v1",
      status: "TEXT_READY",
      stage: "AI_EXTRACTION",
      parserVersion: "parser",
      pageCount: 2,
      attemptCount: 2,
    },
    textPages: [1, 2].map((pageNumber) => ({ pageNumber, checksum })),
    aiPages: [],
    visual: null,
    visualPages: [],
    model: "test-model",
    aiSchema: COMMERCIAL_AI_SCHEMA_VERSION,
    visualSchema: COMMERCIAL_VISUAL_SCHEMA_VERSION,
    enabled: true,
  };
}
export function commercialReviewFixture(
  s = commercialProcessingFixture(),
): CommercialProcessingReview {
  return {
    sourceDocumentId: s.source._id,
    checksum: s.source.checksum,
    basisHash: "b".repeat(64),
    observedAt: processingTime.toISOString(),
    state: "WAITING",
    canResume: true,
    notBefore: null,
    messageFr: "L’analyse attend le service.",
    stages: ["TEXT", "AI", "VISUAL"].map((kind) => ({
      kind: kind as "TEXT" | "AI" | "VISUAL",
      state: kind === "TEXT" ? "READY" : "WAITING",
      readyPages: kind === "TEXT" ? 2 : 0,
      totalPages: 2,
    })),
  };
}
