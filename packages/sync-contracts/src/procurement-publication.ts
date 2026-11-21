import { z } from "zod";
import { procurementCatalogueDraftSchema } from "@fl-copilot/domain";

export const procurementPublicationSchema = procurementCatalogueDraftSchema
  .extend({
    sourceRecordId: z.uuid(),
    originalFilename: z.string().trim().min(1).max(255),
    confirmedAt: z.string().datetime({ offset: true }),
  })
  .refine((p) => {
    let bytes = 0;
    for (const c of JSON.stringify(p)) {
      const point = c.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes <= 750_000;
  }, "Catalogue too large for a single bounded sync command");
export const synchronizedProcurementCatalogueSchema = z
  .strictObject({
    id: z.uuid(),
    storeId: z.uuid(),
    version: z.literal(1),
    publication: procurementPublicationSchema,
  })
  .superRefine((p, ctx) => {
    if (p.id !== p.publication.id || p.storeId !== p.publication.storeId)
      ctx.addIssue({
        code: "custom",
        message: "Procurement snapshot scope mismatch",
      });
  });
export type ProcurementPublication = z.infer<
  typeof procurementPublicationSchema
>;
export type SynchronizedProcurementCatalogue = z.infer<
  typeof synchronizedProcurementCatalogueSchema
>;
export function serializeProcurementPublication(raw: unknown) {
  return JSON.stringify(procurementPublicationSchema.parse(raw));
}
