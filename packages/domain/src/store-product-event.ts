import { z } from "zod";
const id = z.string().uuid(),
  instant = z
    .string()
    .datetime({ offset: true })
    .refine((s) => Number.isFinite(Date.parse(s)), "Vérifiez cette date.")
    .transform((s) => new Date(s).toISOString());
export const storeProductEventTypeSchema = z.enum([
  "TENSION",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "QUALITY_ISSUE",
  "PRICE_INCREASE",
  "SUPPLIER_SHORTAGE",
]);
export const storeEventCaptureSchema = z
  .object({
    id,
    productId: id,
    type: storeProductEventTypeSchema,
    startedAt: instant,
    endedAt: instant.nullable().default(null),
    severity: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().default(null),
    comment: z.string().trim().max(1200).nullable().default(null),
    clientCapturedAt: instant,
  })
  .strict()
  .superRefine((e, c) => {
    if (Date.parse(e.startedAt) > Date.parse(e.clientCapturedAt))
      c.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Le début doit correspondre à une observation déjà faite.",
      });
    if (
      e.endedAt &&
      (Date.parse(e.endedAt) < Date.parse(e.startedAt) ||
        Date.parse(e.endedAt) > Date.parse(e.clientCapturedAt))
    )
      c.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "La fin doit être comprise entre le début et la capture.",
      });
  });
export const createStoreEventPayloadSchema = z
  .object({ event: storeEventCaptureSchema })
  .strict();
export const closeStoreEventPayloadSchema = z
  .object({ endedAt: instant })
  .strict();
export const storeProductEventSchema = z
  .object({
    id,
    storeId: id,
    productId: id,
    type: storeProductEventTypeSchema,
    startedAt: instant,
    endedAt: instant.nullable(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
    comment: z.string().trim().max(1200).nullable(),
    clientCapturedAt: instant,
    source: z.enum(["USER", "COMMERCIAL_PDF"]),
    sourceDocumentId: id.nullable(),
    status: z.enum(["ACTIVE", "CLOSED", "TO_REVIEW"]),
    version: z.number().int().positive(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict()
  .superRefine((e, c) => {
    if (Date.parse(e.startedAt) > Date.parse(e.clientCapturedAt))
      c.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Le début ne peut pas être postérieur à la capture.",
      });
    if ((e.status === "CLOSED") !== (e.endedAt !== null))
      c.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "La clôture doit avoir une date de fin.",
      });
    if (
      e.endedAt &&
      (Date.parse(e.endedAt) < Date.parse(e.startedAt) ||
        Date.parse(e.endedAt) > Date.parse(e.updatedAt))
    )
      c.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "Vérifiez la date et l’heure de fin.",
      });
    if (e.source === "USER" && e.sourceDocumentId !== null)
      c.addIssue({
        code: "custom",
        path: ["sourceDocumentId"],
        message: "Un signalement magasin est distinct d’une instruction PDF.",
      });
  });
export type StoreProductEvent = z.infer<typeof storeProductEventSchema>;
export type StoreEventCapture = z.infer<typeof storeEventCaptureSchema>;
export function prepareStoreProductEvent(storeId: string, payload: unknown) {
  const { event: e } = createStoreEventPayloadSchema.parse(payload);
  return storeProductEventSchema.parse({
    ...e,
    storeId,
    source: "USER",
    sourceDocumentId: null,
    status: e.endedAt ? "CLOSED" : "ACTIVE",
    version: 1,
    createdAt: e.clientCapturedAt,
    updatedAt: e.clientCapturedAt,
  });
}
export function closeStoreProductEvent(
  previous: StoreProductEvent,
  endedAt: string,
  capturedAt: string,
) {
  if (previous.source !== "USER") throw Error("STORE_EVENT_SOURCE_INVALID");
  return storeProductEventSchema.parse({
    ...previous,
    endedAt,
    status: "CLOSED",
    version: previous.version + 1,
    updatedAt: capturedAt,
  });
}
export function storeEventCapturePayload(e: StoreProductEvent) {
  return createStoreEventPayloadSchema.parse({
    event: {
      id: e.id,
      productId: e.productId,
      type: e.type,
      startedAt: e.startedAt,
      endedAt: e.version === 1 ? e.endedAt : null,
      severity: e.severity,
      comment: e.comment,
      clientCapturedAt: e.clientCapturedAt,
    },
  });
}
export function sameStoreEventCapture(
  a: StoreProductEvent,
  b: StoreProductEvent,
) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    a.productId === b.productId &&
    a.type === b.type &&
    a.startedAt === b.startedAt &&
    a.severity === b.severity &&
    a.comment === b.comment &&
    a.clientCapturedAt === b.clientCapturedAt &&
    a.source === b.source &&
    a.sourceDocumentId === b.sourceDocumentId &&
    a.createdAt === b.createdAt
  );
}
export const storeEventLabels: Record<StoreProductEvent["type"], string> = {
  TENSION: "Tension",
  LOW_STOCK: "Stock faible",
  OUT_OF_STOCK: "Rupture",
  QUALITY_ISSUE: "Problème qualité",
  PRICE_INCREASE: "Hausse de prix",
  SUPPLIER_SHORTAGE: "Problème fournisseur",
};
