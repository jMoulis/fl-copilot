import { z } from "zod";
export const commercialProcessingStageSchema = z.enum(["TEXT", "AI", "VISUAL"]);
const processingState = z.enum([
  "WAITING",
  "RUNNING",
  "PARTIAL",
  "READY",
  "BLOCKED",
  "UNAVAILABLE",
]);
export const commercialProcessingReviewSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.string().datetime(),
  state: processingState,
  messageFr: z.string().min(1).max(600),
  canResume: z.boolean(),
  notBefore: z.string().datetime().nullable(),
  stages: z
    .array(
      z.strictObject({
        kind: commercialProcessingStageSchema,
        state: processingState,
        readyPages: z.number().int().min(0).max(100),
        totalPages: z.number().int().min(1).max(100).nullable(),
      }),
    )
    .length(3)
    .refine(
      (stages) =>
        new Set(stages.map((stage) => stage.kind)).size === 3 &&
        stages.every(
          (stage) =>
            stage.totalPages === null || stage.readyPages <= stage.totalPages,
        ),
      "Invalid processing stages",
    ),
});
export const commercialProcessingResumeSchema = z.strictObject({
  operationId: z.uuid(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const commercialProcessingRequestedSchema = z.strictObject({
  operationId: z.uuid(),
  sourceDocumentId: z.uuid(),
  status: z.literal("REQUESTED"),
});
export type CommercialProcessingReview = z.infer<
  typeof commercialProcessingReviewSchema
>;
export type CommercialProcessingResume = z.infer<
  typeof commercialProcessingResumeSchema
>;
export type CommercialProcessingRequested = z.infer<
  typeof commercialProcessingRequestedSchema
>;
export type CommercialProcessingStage = z.infer<
  typeof commercialProcessingStageSchema
>;
