import { z } from "zod";
const source = z
  .object({
    documentId: z.string().uuid(),
    checksum: z.string().min(1),
    readingIds: z.array(z.string().uuid()).min(1).max(16),
  })
  .strict()
  .refine(
    (s) => new Set(s.readingIds).size === s.readingIds.length,
    "Une lecture source apparaît plusieurs fois.",
  );
export const commercialVersionDecisionSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    before: source,
    after: source,
    preference: z.enum(["KEEP_PREVIOUS", "PREFER_NEW"]),
    comparisonReviewed: z.literal(true),
    note: z.string().trim().max(1200),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (d) =>
      d.before.documentId !== d.after.documentId &&
      d.before.checksum !== d.after.checksum,
    "Choisissez deux fichiers originaux différents.",
  );
export type CommercialVersionDecision = z.infer<
  typeof commercialVersionDecisionSchema
>;
