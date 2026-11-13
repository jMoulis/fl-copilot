import {
  economicContextSchema,
  economicDataUrl,
} from "../packages/domain/src/index";
export function economicContextFixture() {
  const point = (period: string, value: string | null) => ({
    period,
    value,
    observationStatus: "A",
    quality: "DEF",
    revised: false,
  });
  return economicContextSchema.parse({
    status: "AVAILABLE",
    provider: "Insee",
    sourceUrl: economicDataUrl,
    retrievedAt: "2026-11-13T08:00:00.000Z",
    validUntil: "2026-11-14T08:00:00.000Z",
    issue: null,
    vintage: "CURRENT_REVISED",
    historicalPublicationDatesKnown: false,
    series: [
      {
        id: "011813720",
        lastUpdated: "2026-10-15",
        points: [point("2025-09", "100"), point("2026-09", "102")],
      },
      {
        id: "001587668",
        lastUpdated: "2026-10-27",
        points: [point("2026-09", "85"), point("2026-10", "80")],
      },
    ],
  });
}
