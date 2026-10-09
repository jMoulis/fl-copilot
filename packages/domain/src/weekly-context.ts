import { z } from "zod";
import type { StoreContextSettings } from "./store-context-settings";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
export const contextWeekQuerySchema = z
  .object({
    weekStart: date.refine((s) => new Date(`${s}T00:00:00Z`).getUTCDay() === 1),
  })
  .strict();
const status = z.enum(["AVAILABLE", "STALE", "UNAVAILABLE", "NOT_CONFIGURED"]);
const metadata = {
  status,
  retrievedAt: z.string().datetime().nullable(),
  validUntil: z.string().datetime().nullable(),
  issue: z
    .enum([
      "PROVIDER_UNAVAILABLE",
      "CITY_AMBIGUOUS",
      "CITY_NOT_FOUND",
      "ZONE_REQUIRED",
    ])
    .nullable(),
};
export const forecastDaySchema = z
  .object({
    validDate: date,
    type: z.literal("FORECAST"),
    temperatureMinC: z.number().finite().nullable(),
    temperatureMaxC: z.number().finite().nullable(),
    temperatureSampleCount: z.number().int().nonnegative(),
    precipitationMm: z.number().finite().nonnegative().nullable(),
    precipitationHours: z.number().int().nonnegative(),
    dayHours: z.number().int().min(23).max(25),
  })
  .strict()
  .superRefine((d, c) => {
    if (
      (d.temperatureSampleCount === 0) !==
        (d.temperatureMinC === null && d.temperatureMaxC === null) ||
      (d.temperatureSampleCount > 0 &&
        (d.temperatureMinC === null || d.temperatureMaxC === null)) ||
      (d.temperatureMinC !== null &&
        d.temperatureMaxC !== null &&
        d.temperatureMinC > d.temperatureMaxC)
    )
      c.addIssue({ code: "custom", message: "Invalid temperature coverage" });
    if (
      d.precipitationHours > d.dayHours ||
      (d.precipitationMm !== null && d.precipitationHours !== d.dayHours)
    )
      c.addIssue({ code: "custom", message: "Invalid precipitation coverage" });
  });
export const weeklyContextSchema = z
  .object({
    storeId: z.string().uuid(),
    settingsFingerprint: z.string().min(1).max(2000),
    weekStart: date,
    weekEnd: date,
    retrievedAt: z.string().datetime(),
    locationLabel: z.string(),
    weather: z
      .object({
        ...metadata,
        provider: z.literal("MET Norway"),
        sourceUrl: z.literal(
          "https://api.met.no/weatherapi/locationforecast/2.0/documentation",
        ),
        issuedAt: z.string().datetime().nullable(),
        days: z.array(forecastDaySchema).max(7),
      })
      .strict(),
    publicHolidays: z
      .object({
        ...metadata,
        provider: z.literal("calendrier.api.gouv.fr"),
        sourceUrl: z.literal("https://calendrier.api.gouv.fr/jours-feries/"),
        days: z
          .array(z.object({ date, label: z.string().min(1) }).strict())
          .max(20),
      })
      .strict(),
    schoolHolidays: z
      .object({
        ...metadata,
        provider: z.literal("Ministère de l’Éducation nationale"),
        sourceUrl: z.literal(
          "https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/",
        ),
        zone: z.enum(["A", "B", "C"]).nullable(),
        periods: z
          .array(
            z
              .object({
                label: z.string().min(1),
                startDate: date,
                resumeDate: date,
                population: z.string().nullable(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      new Date(`${s.weekStart}T00:00:00Z`).getUTCDay() !== 1 ||
      addContextDays(s.weekStart, 6) !== s.weekEnd
    )
      c.addIssue({ code: "custom", message: "Invalid week" });
    if (
      s.weather.days.some(
        (d) => d.validDate < s.weekStart || d.validDate > s.weekEnd,
      ) ||
      new Set(s.weather.days.map((d) => d.validDate)).size !==
        s.weather.days.length
    )
      c.addIssue({ code: "custom", message: "Invalid forecast dates" });
  });
export type WeeklyContext = z.infer<typeof weeklyContextSchema>;
export type ForecastDay = z.infer<typeof forecastDaySchema>;
export function storeContextFingerprint(s: StoreContextSettings) {
  return JSON.stringify([
    s.storeId,
    s.version,
    s.updatedAt,
    s.city,
    s.postalCode,
    s.timezone,
    s.schoolZone,
    s.locationMode,
    s.position,
  ]);
}
export function addContextDays(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
const parisFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function parisDate(time: string) {
  const parts = parisFormatter.formatToParts(new Date(time));
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
