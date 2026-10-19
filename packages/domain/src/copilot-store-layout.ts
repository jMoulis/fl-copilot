import { z } from "zod";
/** Scope comes from the authenticated conversation. Subsequent pages pin an exact selected revision. */
export const copilotStoreLayoutInputSchema = z
  .strictObject({
    view: z.enum(["REFERENCE", "DRAFT"]),
    expectedRevisionId: z.uuid().nullable(),
    targetId: z.uuid().nullable(),
    cursor: z.uuid().nullable(),
    limit: z.number().int().min(1).max(20),
  })
  .refine((v) => v.cursor === null || v.expectedRevisionId !== null, {
    message: "Une page suivante nécessite la révision déjà consultée.",
  });
