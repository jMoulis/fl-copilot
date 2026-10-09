import { z } from "zod";
import {
  addContextDays,
  parisDate,
  type ForecastDay,
} from "@fl-copilot/domain";
const period = z.object({
  details: z.object({
    precipitation_amount: z.number().finite().nonnegative().optional(),
  }),
});
export const metForecastSchema = z.object({
  properties: z.object({
    meta: z.object({
      updated_at: z.string().datetime({ offset: true }),
      units: z.object({
        air_temperature: z.literal("celsius"),
        precipitation_amount: z.literal("mm"),
      }),
    }),
    timeseries: z
      .array(
        z.object({
          time: z.string().datetime({ offset: true }),
          data: z.object({
            instant: z.object({
              details: z.object({
                air_temperature: z.number().finite().optional(),
              }),
            }),
            next_1_hours: period.optional(),
            next_6_hours: period.optional(),
          }),
        }),
      )
      .min(1)
      .max(500),
  }),
});
export function forecastDays(
  input: z.infer<typeof metForecastSchema>,
  weekStart: string,
): ForecastDay[] {
  const series = [...input.properties.timeseries].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  return Array.from({ length: 7 }, (_, i) => {
    const validDate = addContextDays(weekStart, i),
      temperatures: number[] = [],
      rain = new Map<string, number>();
    // Count actual hourly slots in Europe/Paris: DST days can have 23 or 25 hours.
    const dayHours = Array.from({ length: 72 }, (_, j) =>
      new Date(
        Date.parse(`${validDate}T00:00:00Z`) + (j - 24) * 3600000,
      ).toISOString(),
    ).filter((t) => parisDate(t) === validDate).length;
    for (const s of series) {
      if (
        parisDate(s.time) === validDate &&
        s.data.instant.details.air_temperature !== undefined
      )
        temperatures.push(s.data.instant.details.air_temperature);
      const period =
        s.data.next_1_hours?.details.precipitation_amount !== undefined
          ? { hours: 1, mm: s.data.next_1_hours.details.precipitation_amount }
          : s.data.next_6_hours?.details.precipitation_amount !== undefined
            ? { hours: 6, mm: s.data.next_6_hours.details.precipitation_amount }
            : null;
      if (!period) continue;
      const slots = Array.from({ length: period.hours }, (_, h) =>
        new Date(Date.parse(s.time) + h * 3600000).toISOString(),
      );
      // Do not prorate a six-hour interval crossing midnight or overlap hourly forecasts.
      if (slots.some((t) => parisDate(t) !== validDate || rain.has(t)))
        continue;
      for (const t of slots) rain.set(t, period.mm / period.hours);
    }
    return {
      validDate,
      type: "FORECAST",
      temperatureMinC: temperatures.length ? Math.min(...temperatures) : null,
      temperatureMaxC: temperatures.length ? Math.max(...temperatures) : null,
      temperatureSampleCount: temperatures.length,
      precipitationMm:
        rain.size === dayHours
          ? Math.round([...rain.values()].reduce((a, b) => a + b, 0) * 100) /
            100
          : null,
      precipitationHours: rain.size,
      dayHours,
    };
  });
}
