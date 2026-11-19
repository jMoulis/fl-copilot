import {
  weeklyContextSchema,
  retainWeatherHistory,
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
      const incoming = next.journal.transport,
        priorTraffic = previous.journal.transport;
      if (
        typeof incoming !== "string" &&
        typeof priorTraffic !== "string" &&
        incoming.status === "UNAVAILABLE" &&
        priorTraffic.lines.some((l) => l.capturedAt)
      ) {
        next.journal.transport = {
          ...priorTraffic,
          status: "STALE",
          issue: incoming.issue,
          lines: priorTraffic.lines.map((l) => ({
            ...l,
            status: l.capturedAt ? "STALE" : "UNAVAILABLE",
          })),
        };
      }
      if (!next.journal.national && previous.journal.national)
        next.journal.national = previous.journal.national;
      if (next.journal.national)
        next.journal.national = next.journal.national.map((source) => {
          const prior = previous.journal!.national?.find(
            (p) => p.kind === source.kind,
          );
          return source.status === "UNAVAILABLE" && prior?.payload
            ? { ...prior, status: "STALE", issue: source.issue }
            : source;
        });
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
    next.weather = retainWeatherHistory(previous?.weather, next.weather);
    // A failed provider retains its last local value and original freshness timestamps.
    for (const key of ["publicHolidays", "schoolHolidays"] as const) {
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
    | NonNullable<WeeklyContext["weather"]["days"][number]["sourceSnapshot"]>
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
