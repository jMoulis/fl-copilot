import { z } from "zod";
import {
  COMMERCIAL_VISUAL_SCHEMA_VERSION,
  commercialVisualPageOutputSchema,
  commercialVisualEvidenceSchema,
  commercialVisualFieldSchema,
  commercialVisualItemSchema,
  commercialVisualOperationSchema,
} from "@fl-copilot/domain";
const ref = commercialVisualEvidenceSchema.extend({
  verification: z.enum(["TEXT_SUPPORTED", "VISUAL_TO_VERIFY"]),
});
const fields = z
  .array(
    commercialVisualFieldSchema.extend({
      evidence: z.array(ref).max(8),
      validationStatus: z.literal("TO_VALIDATE"),
    }),
  )
  .max(30);
const item = commercialVisualItemSchema.extend({
  fields,
  evidence: z.array(ref).min(1).max(8),
  validationStatus: z.literal("TO_VALIDATE"),
});
const operation = commercialVisualOperationSchema.extend({
  fields,
  evidence: z.array(ref).min(1).max(8),
  items: z.array(item).max(60),
  validationStatus: z.literal("TO_VALIDATE"),
});
export const anchoredCommercialVisualPageSchema =
  commercialVisualPageOutputSchema.extend({
    operations: z.array(operation).max(30),
    tgIdeas: z.array(item).max(20),
    otherInformation: z.array(item).max(40),
  });
export const synchronizedCommercialVisualReadingSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  checksum: z.string().min(1),
  pageNumber: z.number().int().min(1).max(100),
  pageCount: z.number().int().min(1).max(100),
  schemaVersion: z.literal(COMMERCIAL_VISUAL_SCHEMA_VERSION),
  model: z.string().min(1),
  remoteVersion: z.literal(1),
  status: z.enum(["READY", "FAILED"]),
  errorCode: z.string().nullable(),
  reading: anchoredCommercialVisualPageSchema.nullable(),
});
export type SynchronizedCommercialVisualReading = z.infer<
  typeof synchronizedCommercialVisualReadingSchema
>;
