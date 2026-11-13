import { expect, it } from "vitest";
import { dailyJournalContextSchema } from "./daily-journal-context";
import { weeklyContextSchema } from "./weekly-context";
it("keeps Paris capture day distinct from the forecast and rejects crossed store/week scopes", () => {
  const meta = {
    status: "AVAILABLE",
    retrievedAt: "2026-10-09T08:00:00.000Z",
    validUntil: "2026-10-10T08:00:00.000Z",
    issue: null,
  };
  const context = weeklyContextSchema.parse({
    storeId: "00000000-0000-4000-8000-000000000002",
    settingsFingerprint: "test",
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    retrievedAt: meta.retrievedAt,
    locationLabel: "Magasin test",
    weather: {
      ...meta,
      provider: "MET Norway",
      sourceUrl:
        "https://api.met.no/weatherapi/locationforecast/2.0/documentation",
      issuedAt: meta.retrievedAt,
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
      zone: "C",
      periods: [],
    },
  });
  const entry = {
    version: 1,
    storeId: context.storeId,
    scope: "a".repeat(64),
    date: "2026-10-10",
    firstCollectedAt: "2026-10-09T22:30:00.000Z",
    lastCollectedAt: "2026-10-09T23:30:00.000Z",
    contexts: [context],
  };
  expect(
    dailyJournalContextSchema.parse(entry).contexts[0]!.weather.days[0]!.type,
  ).toBe("FORECAST");
  for (const bad of [
    { ...entry, date: "2026-10-09" },
    { ...entry, storeId: "00000000-0000-4000-8000-000000000001" },
    { ...entry, contexts: [context, context] },
    { ...entry, lastCollectedAt: "2026-10-09T21:00:00.000Z" },
  ])
    expect(dailyJournalContextSchema.safeParse(bad).success).toBe(false);
});
