import { z } from "zod";
export const economicMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const economicSeriesIds = ["011813720", "001587668"] as const;
export const economicSeriesLabels = {
  "011813720": "Prix alimentaires · France métropolitaine",
  "001587668": "Confiance des ménages · France métropolitaine",
} as const;
export const economicDataUrl =
  "https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/001587668+011813720";
const point = z.strictObject({
  period: economicMonthSchema,
  value: z
    .string()
    .regex(/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/)
    .nullable(),
  observationStatus: z.string().max(12),
  quality: z.string().max(12),
  revised: z.boolean(),
});
export const economicSeriesSchema = z
  .strictObject({
    id: z.enum(economicSeriesIds),
    lastUpdated: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    points: z.array(point).max(18),
  })
  .superRefine((s, c) => {
    if (new Set(s.points.map((p) => p.period)).size !== s.points.length)
      c.addIssue({ code: "custom", message: "Duplicate economic month" });
    if (
      s.id === "011813720" &&
      s.points.some((p) => p.value !== null && Number(p.value) <= 0)
    )
      c.addIssue({ code: "custom", message: "Invalid price index" });
  });
export const economicDataSchema = z
  .strictObject({
    series: z.array(economicSeriesSchema).length(2),
  })
  .refine(
    (s) => new Set(s.series.map((x) => x.id)).size === 2,
    "Duplicate economic series",
  );
export const economicContextSchema = z
  .strictObject({
    status: z.enum(["AVAILABLE", "STALE", "UNAVAILABLE"]),
    provider: z.literal("Insee"),
    sourceUrl: z.literal(economicDataUrl),
    retrievedAt: z.string().datetime().nullable(),
    validUntil: z.string().datetime().nullable(),
    issue: z.literal("PROVIDER_UNAVAILABLE").nullable(),
    vintage: z.literal("CURRENT_REVISED"),
    // The current series' update date does not establish publication of each value.
    historicalPublicationDatesKnown: z.literal(false),
    series: z.array(economicSeriesSchema).max(2),
  })
  .refine(
    (s) => new Set(s.series.map((x) => x.id)).size === s.series.length,
    "Duplicate economic series",
  );
export type EconomicContext = z.infer<typeof economicContextSchema>;
export function shiftEconomicMonth(month: string, offset: number) {
  economicMonthSchema.parse(month);
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
