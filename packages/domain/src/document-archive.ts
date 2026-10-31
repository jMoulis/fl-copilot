import { z } from "zod";

/** Personal list visibility only: never deletion, withdrawal or source approval. */
export const documentArchiveSchema = z.strictObject({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  targetKind: z.enum([
    "COMMERCIAL_DOCUMENT",
    "MERCALYS_BATCH",
    "MERCALYS_ITEM",
  ]),
  archived: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type DocumentArchive = z.infer<typeof documentArchiveSchema>;
export type DocumentArchiveKind = DocumentArchive["targetKind"];
