import { it, expect } from "vitest";
import { metForecastFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { forecastDays, metForecastSchema } from "./weather";
import { forecastDaySchema } from "@fl-copilot/domain";
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
it("negotiates a dated provider symbol near Paris noon without changing legacy payloads", () => {
  const input = metForecastSchema.parse(metForecastFixture());
  for (const s of input.properties.timeseries) {
    s.data.next_1_hours!.summary = {
      symbol_code: s.time.includes("T10:") ? "partlycloudy_day" : "rain",
    };
  }
  const legacy = forecastDays(input, "2026-10-05").find(
    (d) => d.validDate === "2026-10-10",
  )!;
  expect(legacy.symbol).toBeUndefined();
  const day = forecastDays(input, "2026-10-05", true).find(
    (d) => d.validDate === "2026-10-10",
  )!;
  expect(day.symbol).toEqual({
    code: "partlycloudy_day",
    validFrom: "2026-10-10T10:00:00.000Z",
    validTo: "2026-10-10T11:00:00.000Z",
  });
  expect(forecastDaySchema.parse(day)).toEqual(day);
  expect(day.precipitationMm).toBe(0);
  expect(
    forecastDaySchema.safeParse({
      ...day,
      symbol: { ...day.symbol, validTo: "bad" },
    }).success,
  ).toBe(false);
  expect(
    forecastDaySchema.safeParse({
      ...day,
      symbol: { ...day.symbol, validTo: "2026-10-11T12:00:00.000Z" },
    }).success,
  ).toBe(false);
});
it("keeps symbol windows inside the Paris day and never invents a missing symbol", () => {
  const input = metForecastSchema.parse(
    metForecastFixture("2026-10-10T19:00:00Z", 1),
  );
  input.properties.timeseries[0]!.data.next_6_hours!.summary = {
    symbol_code: "rain",
  };
  expect(
    forecastDays(input, "2026-10-05", true).find(
      (d) => d.validDate === "2026-10-10",
    )!.symbol,
  ).toBeUndefined();
  const absent = metForecastSchema.parse(metForecastFixture());
  expect(forecastDays(absent, "2026-10-05", true).every((d) => !d.symbol)).toBe(
    true,
  );
});
