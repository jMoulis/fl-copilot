import type { WeeklyContext } from "../packages/domain/src/index";
import { storeContextFingerprint } from "../packages/domain/src/index";
import { storeContextFixture } from "./test-store-context-fixtures";
export function weeklyContextFixture(
  settings = storeContextFixture(),
): WeeklyContext {
  const meta = {
    status: "AVAILABLE" as const,
    retrievedAt: "2026-10-09T08:00:00.000Z",
    validUntil: "2026-10-09T09:00:00.000Z",
    issue: null,
  };
  return {
    storeId: settings.storeId,
    settingsFingerprint: storeContextFingerprint(settings),
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    retrievedAt: "2026-10-09T08:00:00.000Z",
    locationLabel: settings.city,
    weather: {
      ...meta,
      provider: "MET Norway",
      sourceUrl:
        "https://api.met.no/weatherapi/locationforecast/2.0/documentation",
      issuedAt: "2026-10-09T07:00:00.000Z",
      days: [
        {
          validDate: "2026-10-10",
          type: "FORECAST",
          temperatureMinC: 9,
          temperatureMaxC: 18,
          temperatureSampleCount: 24,
          precipitationMm: 0,
          precipitationHours: 24,
          dayHours: 24,
        },
      ],
    },
    publicHolidays: {
      ...meta,
      provider: "calendrier.api.gouv.fr",
      sourceUrl: "https://calendrier.api.gouv.fr/jours-feries/",
      days: [],
    },
    schoolHolidays: {
      ...meta,
      provider: "Ministère de l’Éducation nationale",
      sourceUrl:
        "https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/",
      zone: settings.schoolZone,
      periods: [],
    },
  };
}
export function metForecastFixture(
  start = "2026-10-09T22:00:00.000Z",
  count = 24,
) {
  return {
    properties: {
      meta: {
        updated_at: "2026-10-09T07:00:00.000Z",
        units: { air_temperature: "celsius", precipitation_amount: "mm" },
      },
      timeseries: Array.from({ length: count }, (_, i) => ({
        time: new Date(Date.parse(start) + i * 3600000).toISOString(),
        data: {
          instant: { details: { air_temperature: 9 + (i % 10) } },
          next_1_hours: { details: { precipitation_amount: 0 } },
          next_6_hours: { details: { precipitation_amount: 12 } },
        },
      })),
    },
  };
}
