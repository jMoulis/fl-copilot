import { z } from "zod";

export const journalAssociationInputSchema = z
  .strictObject({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    referenceMode: z.enum(["YEAR_OVER_YEAR", "J_MINUS_7"]),
    familyId: z.uuid().nullable(),
  })
  .superRefine((v, c) => {
    const days =
      (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 + 1;
    if (days < 1 || days > 93)
      c.addIssue({
        code: "custom",
        message: "Study requires 1–93 inclusive days",
      });
  });
export type JournalAssociationInput = z.infer<
  typeof journalAssociationInputSchema
>;

const coefficient = z.number().finite().min(-1).max(1).nullable();
export const journalAssociationSeriesSchema = z.strictObject({
  metric: z.enum(["sales", "margin"]),
  exposure: z.enum(["TEMPERATURE_MAX_DELTA_C", "RAINFALL_DELTA_MM"]),
  status: z.enum([
    "INSUFFICIENT_DATA",
    "UNDEFINED",
    "FRAGILE",
    "ASSOCIATION_OBSERVED",
  ]),
  pairs: z.number().int().nonnegative(),
  weeks: z.number().int().nonnegative(),
  rho: coefficient,
  excluded: z.strictObject({
    calendar: z.number().int().nonnegative(),
    business: z.number().int().nonnegative(),
    weather: z.number().int().nonnegative(),
  }),
  leaveOneWeekOut: z.strictObject({
    evaluatedWeeks: z.number().int().nonnegative(),
    min: coefficient,
    max: coefficient,
    sameDirection: z.boolean().nullable(),
  }),
  withoutRecordedEvents: z.strictObject({
    pairs: z.number().int().nonnegative(),
    rho: coefficient,
  }),
});

export const journalAssociationStudySchema = z.strictObject({
  version: z.literal("journal-spearman-v1"),
  query: journalAssociationInputSchema,
  scope: z.enum(["DEPARTMENT", "CURRENT_PRODUCT_FAMILY"]),
  status: z.enum(["DESCRIPTIVE_ONLY", "LIMIT_EXCEEDED"]),
  requestedDays: z.number().int().nonnegative(),
  policy: z.strictObject({
    minimumPairs: z.literal(21),
    minimumWeeks: z.literal(4),
  }),
  series: z.array(journalAssociationSeriesSchema).max(4),
  stationIds: z.array(z.string().regex(/^\d{8}$/)).max(30),
  warnings: z.array(z.string().max(500)).max(12),
});
export type JournalAssociationStudy = z.infer<
  typeof journalAssociationStudySchema
>;
