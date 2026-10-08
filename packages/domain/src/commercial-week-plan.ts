import { z } from "zod";
import { commercialWeekPreparationSchema } from "./commercial-week-preparation";
import { commercialOfferSourceSchema } from "./commercial-offer-choice";
import { commercialMechanismSchema } from "./commercial-mechanisms";
const id = z.string().uuid(),
  version = z.number().int().positive(),
  date = commercialWeekPreparationSchema.shape.weekStart,
  time = z.string().datetime();
export const plannedCommercialOperationSchema = z
  .object({
    id,
    storeId: id,
    planId: id,
    sourceDocumentId: id,
    name: z.string().trim().min(1).max(240),
    kind: z.enum(["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"]),
    operationNature: z
      .array(
        z.enum([
          "PROSPECTUS",
          "COUP_DE_POING",
          "DRAMATIZATION",
          "SUPPORT_TO_PRODUCTION",
          "SPECIAL_RANGE",
          "LOCAL_ACTION",
          "OTHER",
        ]),
      )
      .min(1)
      .max(7),
    announcedStart: date.nullable(),
    announcedEnd: date.nullable(),
    plannedStart: date,
    plannedEnd: date,
    actualStart: z.null(),
    actualEnd: z.null(),
    applicabilityStatus: z.literal("APPLICABLE"),
    planningStatus: z.literal("PLANNED"),
    offerIds: z.array(id).min(1).max(100),
    version,
    createdAt: time,
    updatedAt: time,
  })
  .strict();
export const plannedCommercialOfferSchema = z
  .object({
    id,
    storeId: id,
    planId: id,
    operationId: id,
    productId: id,
    validationId: id,
    choiceId: id,
    choiceVersion: version,
    rawProductLabel: z.string().trim().min(1).max(240),
    status: z.literal("VALIDATED"),
    customerMechanism: commercialMechanismSchema,
    purchaseCondition: z.null(),
    saleStart: date,
    saleEnd: date,
    sourceReference: commercialOfferSourceSchema
      .extend({ pageNumber: z.number().int().min(1).max(100) })
      .strict(),
    note: z.string().trim().max(1200).nullable(),
    version,
    createdAt: time,
    updatedAt: time,
  })
  .strict();
export const commercialWeekPlanSchema = z
  .object({
    id,
    revisionId: id,
    storeId: id,
    weekStart: date,
    weekEnd: date,
    status: z.literal("VALIDATED"),
    preparation: commercialWeekPreparationSchema,
    validationRefs: z
      .array(
        z
          .object({ choiceId: id, choiceVersion: version, validationId: id })
          .strict(),
      )
      .min(1)
      .max(100),
    preferenceRefs: z.array(z.object({ id, version }).strict()).max(200),
    productRefs: z
      .array(
        z
          .object({ id, version, label: z.string().trim().min(1).max(240) })
          .strict(),
      )
      .min(1)
      .max(100),
    operations: z.array(plannedCommercialOperationSchema).min(1).max(100),
    offers: z.array(plannedCommercialOfferSchema).min(1).max(100),
    groupingConfirmed: z.literal(true),
    validationConfirmed: z.literal(true),
    version,
    createdAt: time,
    updatedAt: time,
    validatedAt: time,
  })
  .strict()
  .superRefine((p, c) => {
    if (
      p.preparation.storeId !== p.storeId ||
      p.preparation.weekStart !== p.weekStart ||
      p.preparation.weekEnd !== p.weekEnd
    )
      c.addIssue({
        code: "custom",
        message:
          "La semaine validée doit correspondre au brouillon du magasin.",
      });
    const choices = new Map(
      p.preparation.offerRefs.map((r) => [r.choiceId, r.choiceVersion]),
    );
    if (
      p.validationRefs.length !== choices.size ||
      p.offers.length !== choices.size ||
      new Set(p.validationRefs.map((r) => r.choiceId)).size !== choices.size ||
      new Set(p.offers.map((o) => o.choiceId)).size !== choices.size
    )
      c.addIssue({
        code: "custom",
        message:
          "Validez exactement les offres sélectionnées, sans ajout ni doublon.",
      });
    for (const ref of p.validationRefs)
      if (choices.get(ref.choiceId) !== ref.choiceVersion)
        c.addIssue({
          code: "custom",
          message:
            "Une validation ne correspond pas à la version sélectionnée.",
        });
    if (
      new Set(p.operations.map((o) => o.id)).size !== p.operations.length ||
      new Set(p.offers.map((o) => o.id)).size !== p.offers.length ||
      new Set(p.productRefs.map((o) => o.id)).size !== p.productRefs.length ||
      new Set(p.preferenceRefs.map((o) => o.id)).size !==
        p.preferenceRefs.length
    )
      c.addIssue({
        code: "custom",
        message: "Les références du plan doivent être distinctes.",
      });
    for (const o of p.offers)
      if (
        o.storeId !== p.storeId ||
        o.planId !== p.id ||
        o.version !== p.version ||
        !p.operations.some(
          (g) => g.id === o.operationId && g.offerIds.includes(o.id),
        ) ||
        !p.validationRefs.some(
          (v) =>
            v.validationId === o.validationId &&
            v.choiceId === o.choiceId &&
            v.choiceVersion === o.choiceVersion,
        ) ||
        !p.productRefs.some((r) => r.id === o.productId)
      )
        c.addIssue({
          code: "custom",
          message:
            "Une offre est détachée de son opération, de son produit ou de sa validation.",
        });
    for (const op of p.operations)
      if (
        op.planId !== p.id ||
        op.storeId !== p.storeId ||
        op.version !== p.version ||
        new Set(op.offerIds).size !== op.offerIds.length ||
        op.offerIds.some(
          (id) => !p.offers.some((o) => o.id === id && o.operationId === op.id),
        )
      )
        c.addIssue({
          code: "custom",
          message: "Une opération ne correspond pas aux offres du plan.",
        });
    if (p.updatedAt !== p.validatedAt)
      c.addIssue({
        code: "custom",
        message: "La date de cette version doit correspondre à sa validation.",
      });
    for (const o of p.offers) {
      const op = p.operations.find((op) => op.id === o.operationId);
      if (
        o.createdAt !== p.createdAt ||
        o.updatedAt !== p.updatedAt ||
        o.saleEnd < o.saleStart ||
        op?.plannedStart !== o.saleStart ||
        op?.plannedEnd !== o.saleEnd ||
        op?.sourceDocumentId !== o.sourceReference.sourceDocumentId
      )
        c.addIssue({
          code: "custom",
          message:
            "Les dates ou la source d’une offre ne correspondent pas à son opération.",
        });
    }
    for (const op of p.operations)
      if (
        op.createdAt !== p.createdAt ||
        op.updatedAt !== p.updatedAt ||
        op.plannedEnd < op.plannedStart
      )
        c.addIssue({
          code: "custom",
          message:
            "Les dates de l’opération ne correspondent pas à cette version du plan.",
        });
    if (
      p.productRefs.some((r) => !p.offers.some((o) => o.productId === r.id)) ||
      new Set(p.validationRefs.map((r) => r.validationId)).size !==
        p.validationRefs.length
    )
      c.addIssue({
        code: "custom",
        message: "Le plan contient des références supplémentaires ou répétées.",
      });
    const bytes = Array.from(JSON.stringify(p)).reduce(
      (n, s) =>
        n +
        (s.codePointAt(0)! < 128
          ? 1
          : s.codePointAt(0)! < 2048
            ? 2
            : s.codePointAt(0)! < 65536
              ? 3
              : 4),
      0,
    );
    if (bytes > 750000)
      c.addIssue({
        code: "custom",
        message:
          "Le plan est trop volumineux. Réduisez les longues notes ou le nombre d’offres avant de confirmer.",
      });
  });
export const commercialPlanRevisionSchema = z
  .object({
    id,
    storeId: id,
    plan: commercialWeekPlanSchema,
    version: z.literal(1),
  })
  .strict()
  .refine(
    (r) => r.storeId === r.plan.storeId && r.id === r.plan.revisionId,
    "La révision ne correspond pas au plan.",
  );
export type CommercialWeekPlan = z.infer<typeof commercialWeekPlanSchema>;
export type CommercialPlanRevision = z.infer<
  typeof commercialPlanRevisionSchema
>;
export type PlannedCommercialOperation = z.infer<
  typeof plannedCommercialOperationSchema
>;
export type PlannedCommercialOffer = z.infer<
  typeof plannedCommercialOfferSchema
>;
