import { z } from "zod";
import {
  sourceTypeSchema,
  localSourceSyncStateSchema,
  remoteUploadStatusSchema,
  localSourceProcessingStatusSchema,
} from "./source-documents";
export const sourceReferenceInputSchema = z.strictObject({
  sourceDocumentId: z.string().uuid(),
});
export const sourceReferenceRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("source.reference"),
  input: sourceReferenceInputSchema,
});
export const sourceReferenceResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("source.reference"),
  status: z.literal("COMPLETED"),
  message: z.string(),
  observedAt: z.string().datetime(),
  source: z
    .strictObject({
      sourceDocumentId: z.string().uuid(),
      sourceType: sourceTypeSchema,
      filename: z.string().nullable(),
      businessPeriodStart: z.string().date().nullable(),
      businessPeriodEnd: z.string().date().nullable(),
      processingStatus: localSourceProcessingStatusSchema,
      uploadStatus: remoteUploadStatusSchema,
      syncState: localSourceSyncStateSchema,
      openAction: z
        .strictObject({
          kind: z.literal("COMMERCIAL_ORIGINAL"),
          sourceDocumentId: z.string().uuid(),
        })
        .nullable(),
    })
    .nullable(),
});
export const sourceReferenceTool = {
  name: "source.reference",
  schemaVersion: 1 as const,
  effect: "READ" as const,
  runtime: "LOCAL" as const,
  confirmation: "NONE" as const,
  inputSchema: sourceReferenceInputSchema,
  outputSchema: sourceReferenceResultSchema,
  description:
    "Retrouver une source autorisée et la référence permettant d’ouvrir son PDF original. Aucun chemin ou lien signé n’est envoyé au modèle.",
  progress: "Lecture de la référence source…",
};
