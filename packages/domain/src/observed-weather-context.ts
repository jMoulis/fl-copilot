import { z } from "zod";
export const observedWeatherSourceUrl =
  "https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes";
const date = z.iso.date();
const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/);
export const weatherMeasurementSchema = z
  .strictObject({
    sourceValue: decimal.nullable(),
    qualityCode: z.string().max(8).nullable(),
    quality: z.enum([
      "MISSING",
      "PROTECTED",
      "VALIDATED",
      "SUSPECT",
      "FILTERED_ONLY",
      "UNQUALIFIED",
    ]),
    analysisValue: decimal.nullable(),
  })
  .superRefine((v, c) => {
    const expected =
      v.sourceValue === null
        ? "MISSING"
        : v.qualityCode === "0"
          ? "PROTECTED"
          : v.qualityCode === "1"
            ? "VALIDATED"
            : v.qualityCode === "2"
              ? "SUSPECT"
              : v.qualityCode === "9"
                ? "FILTERED_ONLY"
                : "UNQUALIFIED";
    if (
      v.quality !== expected ||
      v.analysisValue !==
        (expected === "PROTECTED" || expected === "VALIDATED"
          ? v.sourceValue
          : null)
    )
      c.addIssue({
        code: "custom",
        message: "Invalid observed measurement qualification",
      });
  });
export const weatherStationSchema = z.strictObject({
  id: z.string().regex(/^\d{8}$/),
  name: z.string().min(1).max(150),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  altitudeM: decimal.nullable(),
});
export const observedWeatherDaySchema = z
  .strictObject({
    producerDate: date,
    station: weatherStationSchema,
    measurements: z.strictObject({
      TN: weatherMeasurementSchema,
      TX: weatherMeasurementSchema,
      RR: weatherMeasurementSchema,
    }),
    sourceRow: z.number().int().min(2),
    temperatureUnit: z.literal("C"),
    rainfallUnit: z.literal("mm"),
    temperatureWindow: z.literal("PRODUCER_DAILY_EXTREMA"),
    rainfallWindow: z.strictObject({
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      dateAttribution: z.literal("PRODUCER_DATE"),
    }),
    sourceUrl: z
      .url()
      .regex(
        /^https:\/\/meteofrance\.s3\.sbg\.io\.cloud\.ovh\.net\/data\/synchro_ftp\/BASE\/QUOT\/Q_(?:\d{2}|2[AB])_[a-z]+-\d{4}-\d{4}_RR-T-Vent\.csv\.gz$/,
      ),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRetrievedAt: z.iso.datetime(),
  })
  .superRefine((d, c) => {
    const start = `${d.producerDate}T06:00:00.000Z`,
      end = new Date(Date.parse(start) + 86400000).toISOString();
    if (
      d.rainfallWindow.from !== start ||
      d.rainfallWindow.to !== end ||
      end > d.sourceRetrievedAt
    )
      c.addIssue({
        code: "custom",
        message: "Unfinished or altered producer rain window",
      });
    const tn = d.measurements.TN.analysisValue,
      tx = d.measurements.TX.analysisValue,
      rr = d.measurements.RR.analysisValue;
    if (
      (tn !== null && tx !== null && Number(tn) > Number(tx)) ||
      (rr !== null && Number(rr) < 0)
    )
      c.addIssue({
        code: "custom",
        message: "Invalid observed weather values",
      });
  });
export const observedWeatherContextSchema = z
  .strictObject({
    status: z.enum(["AVAILABLE", "STALE", "UNAVAILABLE"]),
    provider: z.literal("Météo-France"),
    sourceUrl: z.literal(observedWeatherSourceUrl),
    retrievedAt: z.iso.datetime().nullable(),
    validUntil: z.iso.datetime().nullable(),
    issue: z
      .enum([
        "PROVIDER_UNAVAILABLE",
        "LOCATION_UNAVAILABLE",
        "UNSUPPORTED_REGION",
        "NO_ARCHIVE",
        "NO_STATION",
        "PERIOD_NOT_OBSERVED",
      ])
      .nullable(),
    selection: z.literal("AUTO_DEPARTMENT_NEAREST"),
    reference: z
      .strictObject({
        station: weatherStationSchema,
        distanceKm: z.number().finite().nonnegative(),
      })
      .nullable(),
    publicationDatesKnown: z.literal(false),
    days: z.array(observedWeatherDaySchema).max(7),
  })
  .superRefine((s, c) => {
    if (
      new Set(s.days.map((d) => d.producerDate)).size !== s.days.length ||
      s.days.some((d) => d.station.id !== s.reference?.station.id)
    )
      c.addIssue({
        code: "custom",
        message: "Invalid observed weather reference",
      });
  });
export type ObservedWeatherContext = z.infer<
  typeof observedWeatherContextSchema
>;
