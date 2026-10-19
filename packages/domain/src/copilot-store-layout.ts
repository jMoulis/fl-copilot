import { z } from "zod";
import { storeLayoutSchema } from "./store-layout";
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

/** Private canonical snapshot, validated before any model-facing projection. */
export const storeLayoutReadSnapshotSchema = z.strictObject({
  head: storeLayoutSchema.nullable(),
  reference: storeLayoutSchema.nullable(),
});
export function validateStoreLayoutReadSnapshot(storeId: string, raw: unknown) {
  z.uuid().parse(storeId);
  const { head, reference } = storeLayoutReadSnapshotSchema.parse(raw);
  if (
    (head && (head.storeId !== storeId || head.id !== storeId)) ||
    (reference &&
      (!head ||
        reference.storeId !== storeId ||
        reference.id !== storeId ||
        reference.revisionId !== head.referenceRevisionId ||
        reference.action !== "ADOPT_REFERENCE" ||
        reference.version > head.version ||
        reference.createdAt !== head.createdAt)) ||
    (head?.referenceRevisionId && !reference)
  )
    throw Error("STORE_LAYOUT_SCOPE_INVALID");
  if (
    head &&
    reference &&
    ((reference.version >= head.version &&
      reference.revisionId !== head.revisionId) ||
      (reference.revisionId === head.revisionId &&
        JSON.stringify(reference) !== JSON.stringify(head)))
  )
    throw Error("STORE_LAYOUT_REFERENCE_INVALID");
  return { head, reference };
}
