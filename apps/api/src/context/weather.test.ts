import { it, expect } from "vitest";
import { metForecastFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { forecastDays, metForecastSchema } from "./weather";
it("keeps missing rain distinct from zero and does not sum overlapping six-hour and hourly windows", () => {
  const input = metForecastSchema.parse(metForecastFixture());
  const day = forecastDays(input, "2026-10-05").find(
    (d) => d.validDate === "2026-10-10",
  )!;
  expect(day).toMatchObject({
    dayHours: 24,
    precipitationHours: 24,
    precipitationMm: 0,
    temperatureMinC: 9,
    temperatureMaxC: 18,
  });
  const partial = metForecastSchema.parse(metForecastFixture(undefined, 8));
  expect(
    forecastDays(partial, "2026-10-05").find(
      (d) => d.validDate === "2026-10-10",
    ),
  ).toMatchObject({ precipitationMm: null, precipitationHours: 8 });
  expect(
    forecastDays(input, "2026-10-19").every(
      (d) => d.temperatureMinC === null && d.precipitationMm === null,
    ),
  ).toBe(true);
});
it("uses Paris day boundaries including DST and never prorates rain across midnight", () => {
  for (const [start, week, date, hours] of [
    ["2026-03-28T23:00:00Z", "2026-03-23", "2026-03-29", 23],
    ["2026-10-24T22:00:00Z", "2026-10-19", "2026-10-25", 25],
  ] as const) {
    const input = metForecastSchema.parse(metForecastFixture(start, hours));
    expect(
      forecastDays(input, week).find((d) => d.validDate === date),
    ).toMatchObject({
      dayHours: hours,
      precipitationHours: hours,
      precipitationMm: 0,
    });
  }
  const input = metForecastSchema.parse(
    metForecastFixture("2026-10-10T19:00:00Z", 1),
  );
  delete input.properties.timeseries[0]!.data.next_1_hours;
  expect(
    forecastDays(input, "2026-10-05").find((d) => d.validDate === "2026-10-10"),
  ).toMatchObject({ precipitationHours: 0, precipitationMm: null });
});
it("refuses malformed or incompatible provider units rather than labelling them Celsius", () => {
  const input = metForecastFixture();
  input.properties.meta.units.air_temperature = "fahrenheit";
  expect(metForecastSchema.safeParse(input).success).toBe(false);
});
