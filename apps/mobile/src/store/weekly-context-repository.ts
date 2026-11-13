import {
  weeklyContextSchema,
  storeContextFingerprint,
  type WeeklyContext,
  type StoreContextSettings,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
export class WeeklyContextRepository {
  constructor(private db: OutboxDatabase) {}
  async get(settings: StoreContextSettings, weekStart: string) {
    const row = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM weekly_context_cache WHERE store_id=? AND week_start=? AND settings_fingerprint=?",
      settings.storeId,
      weekStart,
      storeContextFingerprint(settings),
    );
    return row ? weeklyContextSchema.parse(JSON.parse(row.payload_json)) : null;
  }
  async save(input: WeeklyContext, settings: StoreContextSettings) {
    const next = weeklyContextSchema.parse(input);
    if (
      next.storeId !== settings.storeId ||
      next.settingsFingerprint !== storeContextFingerprint(settings)
    )
      throw Error("CONTEXT_SETTINGS_CHANGED");
    const previous = await this.get(settings, next.weekStart);
    if (previous && previous.retrievedAt > next.retrievedAt) return previous;
    if (!next.journal && previous?.journal) next.journal = previous.journal;
    if (next.journal && previous?.journal) {
      next.journal.sources = next.journal.sources.map((source) => {
        const prior = previous.journal!.sources.find(
          (p) => p.kind === source.kind,
        );
        return source.status === "UNAVAILABLE" && prior?.payload
          ? { ...prior, status: "STALE", issue: source.issue }
          : source;
      });
    }
    if (
      previous?.economy &&
      (!next.economy ||
        next.economy.status === "UNAVAILABLE" ||
        (next.economy.retrievedAt &&
          previous.economy.retrievedAt &&
          next.economy.retrievedAt < previous.economy.retrievedAt))
    ) {
      next.economy = {
        ...previous.economy,
        ...(next.economy?.status === "UNAVAILABLE"
          ? { status: "STALE" as const, issue: "PROVIDER_UNAVAILABLE" as const }
          : {}),
      };
    }
    if (
      previous?.observedWeather &&
      (!next.observedWeather ||
        next.observedWeather.status === "UNAVAILABLE" ||
        (next.observedWeather.retrievedAt &&
          previous.observedWeather.retrievedAt &&
          next.observedWeather.retrievedAt <
            previous.observedWeather.retrievedAt))
    ) {
      next.observedWeather = {
        ...previous.observedWeather,
        ...(next.observedWeather?.status === "UNAVAILABLE"
          ? { status: "STALE" as const, issue: "PROVIDER_UNAVAILABLE" as const }
          : {}),
      };
    }
    // A fresh horizon no longer contains past forecasts. Retain the explicitly
    // archived local forecast, with its original timestamps, beside observations.
    const hasForecast = (days: WeeklyContext["weather"]["days"]) =>
      days.some(
        (d) =>
          d.temperatureSampleCount > 0 ||
          !!d.symbol ||
          d.precipitationHours > 0,
      );
    if (
      previous &&
      hasForecast(previous.weather.days) &&
      !hasForecast(next.weather.days)
    ) {
      next.weather = {
        ...previous.weather,
        status: "STALE",
        issue: next.weather.issue,
      };
    }
    // A failed provider retains its last local value and original freshness timestamps.
    for (const key of [
      "weather",
      "publicHolidays",
      "schoolHolidays",
    ] as const) {
      if (
        previous?.[key].retrievedAt &&
        (next[key].status === "UNAVAILABLE" ||
          (!!next[key].retrievedAt &&
            next[key].retrievedAt! < previous[key].retrievedAt!))
      ) {
        Object.assign(next[key], previous[key], {
          status:
            next[key].status === "UNAVAILABLE" || next[key].status === "STALE"
              ? "STALE"
              : previous[key].status,
          issue: next[key].issue,
        });
      }
    }
    await this.db.runAsync(
      "INSERT INTO weekly_context_cache(store_id,week_start,settings_fingerprint,payload_json) VALUES(?,?,?,?) ON CONFLICT(store_id,week_start,settings_fingerprint) DO UPDATE SET payload_json=excluded.payload_json WHERE json_extract(weekly_context_cache.payload_json,'$.retrievedAt') <= json_extract(excluded.payload_json,'$.retrievedAt')",
      next.storeId,
      next.weekStart,
      next.settingsFingerprint,
      JSON.stringify(next),
    );
    return (await this.get(settings, next.weekStart))!;
  }
}
export function contextIsStale(
  provider:
    | WeeklyContext["weather"]
    | WeeklyContext["publicHolidays"]
    | WeeklyContext["schoolHolidays"]
    | NonNullable<WeeklyContext["economy"]>
    | NonNullable<WeeklyContext["observedWeather"]>,
  now: Date,
) {
  return (
    provider.status === "STALE" ||
    !!(provider.validUntil && provider.validUntil <= now.toISOString())
  );
}
