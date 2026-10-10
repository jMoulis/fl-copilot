import { z } from "zod";
const id = z.string().uuid(),
  decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/),
  instant = z.string().datetime(),
  day = z.string().date();
export const SUBSTITUTION_EVIDENCE_RULE_VERSION =
  "substitution-evidence-daily.v1";
export const substitutionEvidenceStatusSchema = z.enum([
  "READY",
  "WAITING_EVENT_END",
  "WAITING_DAILY_CLOSE",
  "MISSING_SALES",
  "INVALID_REFERENCE",
  "DUPLICATE_EVENT_REVIEW",
  "INELIGIBLE",
  "WINDOW_TOO_LONG",
]);
export const substitutionEvidenceSchema = z
  .object({
    id,
    storeId: id,
    relationshipId: id,
    sourceProductId: id,
    candidateSubstituteProductId: id,
    needUnitId: id,
    eventId: id,
    status: substitutionEvidenceStatusSchema,
    granularity: z.literal("DAY"),
    metric: z.literal("MERCALYS_SOURCE_SALES_VALUE_EUR"),
    ruleVersion: z.literal(SUBSTITUTION_EVIDENCE_RULE_VERSION),
    inputRevision: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().positive(),
    eventStartedAt: instant,
    eventEndedAt: instant.nullable(),
    observationStart: instant.nullable(),
    observationEnd: instant.nullable(),
    observationDates: z.array(day).max(93),
    partialEventDays: z.boolean(),
    dailyComparisons: z
      .array(
        z
          .object({
            date: day,
            actualSalesValue: decimal.nullable(),
            expectedSalesValue: decimal.nullable(),
            referenceDays: z
              .array(
                z
                  .object({
                    date: day,
                    salesValue: decimal,
                    observationIds: z.array(id),
                  })
                  .strict(),
              )
              .max(4),
          })
          .strict(),
      )
      .max(93),
    contextSnapshot: z
      .object({
        holidayDates: z.array(day),
        schoolHolidayDates: z.array(day),
        operations: z.array(
          z
            .object({
              id,
              productIds: z.array(id),
              start: day,
              end: day,
              state: z.enum(["PLANNED", "DECLARED_TASK_DONE"]),
            })
            .strict(),
        ),
      })
      .strict(),
    referenceMethod: z.literal("SAME_WEEKDAY_PRE_EVENT_MEAN_4_WEEKS"),
    referenceStart: day.nullable(),
    referenceEnd: day.nullable(),
    referenceDates: z.array(day).max(372),
    expectedSalesValue: decimal.nullable(),
    actualSalesValue: decimal.nullable(),
    expectedQuantity: z.null(),
    actualQuantity: z.null(),
    observedVariationPct: decimal.nullable(),
    observationSalesIds: z.array(id).max(20000),
    referenceSalesIds: z.array(id).max(20000),
    sourceSalesIds: z.array(id).max(20000),
    sourceRecordIds: z.array(id).max(20000),
    concurrentCommercialOperationIds: z.array(id).max(1000),
    concurrentStoreEventIds: z.array(id).max(1000),
    weatherRecordIds: z.array(id).max(1000),
    contextSourceIds: z.array(z.string().min(1).max(300)).max(1000),
    contextCoverage: z
      .object({
        promotions: z.enum(["PARTIAL", "UNKNOWN"]),
        weather: z.literal("UNKNOWN"),
        publicHolidays: z.enum(["KNOWN", "PARTIAL", "UNKNOWN"]),
        schoolHolidays: z.enum(["KNOWN", "PARTIAL", "UNKNOWN"]),
        marketTension: z.literal("UNKNOWN"),
      })
      .strict(),
    reasons: z.array(z.string().min(1).max(100)).max(100),
    evidenceStrength: z.number().finite().min(0).max(0.5).nullable(),
    dataQuality: z.number().finite().min(0).max(1).nullable(),
    interpretation: z
      .enum(["SUPPORTS_SUBSTITUTION", "NEUTRAL", "CONTRADICTS_SUBSTITUTION"])
      .nullable(),
    notes: z.string().max(2500),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict()
  .superRefine((e, c) => {
    if (
      e.status === "READY" &&
      (e.expectedSalesValue === null ||
        e.actualSalesValue === null ||
        e.observedVariationPct === null ||
        e.dataQuality === null ||
        e.evidenceStrength === null ||
        e.interpretation === null)
    )
      c.addIssue({
        code: "custom",
        message: "Un indice exploitable exige une comparaison complète.",
      });
    if (
      e.status !== "READY" &&
      (e.observedVariationPct !== null ||
        e.interpretation !== null ||
        e.evidenceStrength !== null ||
        e.dataQuality !== null)
    )
      c.addIssue({
        code: "custom",
        message: "Une analyse incomplète ne produit pas de signal appris.",
      });
  });
export type SubstitutionEvidence = z.infer<typeof substitutionEvidenceSchema>;
export async function substitutionEvidenceId(
  storeId: string,
  eventId: string,
  relationshipId: string,
  digest: (s: string) => Promise<string>,
) {
  const h = (
    await digest(
      JSON.stringify([
        "substitution-evidence.v1",
        storeId,
        eventId,
        relationshipId,
      ]),
    )
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(h))
    throw Error("SUBSTITUTION_EVIDENCE_DIGEST_INVALID");
  const a = h.slice(0, 32).split("");
  a[12] = "8";
  a[16] = (8 + (parseInt(a[16]!, 16) & 3)).toString(16);
  const v = a.join("");
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
}

export const substitutionEvidenceStateSchema = z
  .object({
    id,
    storeId: id,
    eventId: id,
    status: z.enum(["QUEUED", "WAITING", "READY", "NO_RELATIONS", "ERROR"]),
    reasons: z.array(z.string().max(100)).max(100),
    evidenceIds: z.array(id).max(500),
    version: z.number().int().positive(),
    updatedAt: instant,
  })
  .strict();
export type SubstitutionEvidenceState = z.infer<
  typeof substitutionEvidenceStateSchema
>;
