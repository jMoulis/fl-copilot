import { expect, it } from "vitest";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import {
  journalCalendar,
  journalWeatherDate,
  journalWeekDates,
  weatherPresentation,
  weatherNumber,
} from "./journal-presentation";

it("does not turn zero rain into sunny skies or archived forecasts into observations", () => {
  const day = weeklyContextFixture().weather.days[0]!;
  expect(weatherPresentation(day).icon).toBe("thermometer-outline");
  expect(weatherNumber(0)).toBe("0");
  expect(weatherNumber(null)).toBe("—");
  const now = new Date("2026-10-10T22:30:00Z");
  expect(journalWeatherDate("2026-10-10", now)).toBe("Prévision archivée");
  expect(journalWeatherDate("2026-10-11", now)).toBe("Prévision");
  expect(
    weatherPresentation({
      ...day,
      symbol: {
        code: "clearsky_night",
        validFrom: "2026-10-10T00:00:00Z",
        validTo: "2026-10-10T01:00:00Z",
      },
    }).icon,
  ).toBe("moon");
});
it("respects the exclusive school return date, unknown calendars and calendar expiry", () => {
  const ctx = weeklyContextFixture();
  ctx.schoolHolidays.periods = [
    {
      startDate: "2026-10-17",
      resumeDate: "2026-11-02",
      label: "Toussaint",
      population: "-",
    },
  ];
  ctx.schoolHolidays.validUntil = "2026-11-12T00:00:00Z";
  const now = new Date("2026-11-01T12:00:00Z");
  expect(journalCalendar(ctx, "2026-11-01", now).join()).toContain("Toussaint");
  expect(journalCalendar(ctx, "2026-11-02", now).join()).toContain(
    "Hors vacances",
  );
  ctx.schoolHolidays.status = "UNAVAILABLE";
  expect(journalCalendar(ctx, "2026-11-02", now)).toEqual([]);
  ctx.schoolHolidays.status = "STALE";
  expect(journalCalendar(ctx, "2026-11-02", now)).toEqual([]);
  expect(journalWeekDates("2026-12-28")).toEqual([
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
});
