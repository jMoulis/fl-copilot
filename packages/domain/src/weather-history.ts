import type { ForecastDay, WeeklyContext } from "./weekly-context";

type Weather = WeeklyContext["weather"];
export const hasForecastValues = (day: ForecastDay) =>
  day.temperatureSampleCount > 0 || !!day.symbol || day.precipitationHours > 0;

/** Keep whole daily snapshots: an empty rolling horizon cannot erase history,
 * and retained days must not inherit the fresh horizon's source timestamps. */
export function retainWeatherHistory(
  previous: Weather | undefined,
  next: Weather,
): Weather {
  if (!previous) return next;
  if (next.status === "UNAVAILABLE" && !previous.days.some(hasForecastValues))
    return next;
  if (
    next.status === "UNAVAILABLE" ||
    (previous.retrievedAt &&
      next.retrievedAt &&
      previous.retrievedAt > next.retrievedAt) ||
    (previous.days.some(hasForecastValues) &&
      !next.days.some(hasForecastValues))
  ) {
    return { ...previous, status: "STALE", issue: next.issue };
  }
  const days = new Map(next.days.map((day) => [day.validDate, day]));
  for (const day of previous.days) {
    const incoming = days.get(day.validDate);
    if (hasForecastValues(day) && (!incoming || !hasForecastValues(incoming))) {
      days.set(day.validDate, {
        ...day,
        sourceSnapshot: {
          ...(day.sourceSnapshot ?? {
            retrievedAt: previous.retrievedAt,
            issuedAt: previous.issuedAt,
            validUntil: previous.validUntil,
          }),
          status: "STALE",
        },
      });
    }
  }
  return {
    ...next,
    days: [...days.values()].sort((a, b) =>
      a.validDate.localeCompare(b.validDate),
    ),
  };
}
