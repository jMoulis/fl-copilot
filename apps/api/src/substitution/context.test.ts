import { it, expect } from "vitest";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { evidenceCachedContext } from "./context";
it("never interprets a forecast as observed weather or stale calendars as complete", () => {
  const now = "2026-10-10T12:00:00Z",
    rows = [
      {
        _id: "weather",
        url: "https://api.met.no/weatherapi/locationforecast/2.0/compact",
        data: { forecast: true },
        validUntil: "2026-10-11T12:00:00Z",
      },
      {
        _id: "expired",
        url: "https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json",
        data: {},
        validUntil: "2026-10-09T12:00:00Z",
      },
    ];
  const ctx = evidenceCachedContext(rows, undefined, ["2026-10-09"], now);
  expect(ctx.publicHolidayCoverage).toBe("UNKNOWN");
  expect(ctx.sourceIds).toEqual([]);
});
it("distinguishes an authoritative empty holiday list from unknown and refuses truncated/wrong-zone school data", () => {
  const settings = storeContextFixture(),
    at = "2026-10-10T12:00:00Z",
    where =
      "zones = 'Zone C' AND start_date <= date'2026-10-11' AND end_date >= date'2026-10-01'",
    school = {
      _id: "school",
      url: `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?${new URLSearchParams({ where, limit: "100" })}`,
      validUntil: "2026-10-11T12:00:00Z",
      data: { total_count: 2, results: [] },
    },
    holiday = {
      _id: "holiday",
      url: "https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json",
      validUntil: "2026-10-11T12:00:00Z",
      data: {},
    };
  const ctx = evidenceCachedContext(
    [school, holiday],
    settings,
    ["2026-10-09"],
    at,
  );
  expect(ctx.publicHolidayCoverage).toBe("KNOWN");
  expect(ctx.holidayDates).toEqual([]);
  expect(ctx.schoolHolidayCoverage).toBe("UNKNOWN");
});
