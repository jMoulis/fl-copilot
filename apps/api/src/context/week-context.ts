import { z } from "zod";
import {
  storeContextSettingsSchema,
  weeklyContextSchema,
  storeContextFingerprint,
  addContextDays,
  parisDate,
  type WeeklyContext,
} from "@fl-copilot/domain";
import type { DatabaseService } from "../database/types.js";
import { AuthError } from "../auth/service.js";
import { ContextProviderCache, type ProviderResult } from "./provider-cache.js";
import { metForecastSchema, forecastDays } from "./weather.js";
const communes = z
  .array(
    z.object({
      nom: z.string(),
      code: z.string(),
      centre: z.object({
        coordinates: z.tuple([
          z.number().finite().min(-180).max(180),
          z.number().finite().min(-90).max(90),
        ]),
      }),
    }),
  )
  .max(1000);
const holidays = z.record(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.string().min(1),
);
const schools = z
  .object({
    total_count: z.number().int().nonnegative(),
    results: z
      .array(
        z.object({
          description: z.string().min(1),
          start_date: z.string().datetime({ offset: true }),
          end_date: z.string().datetime({ offset: true }),
          population: z.string().nullable(),
          zones: z.string(),
        }),
      )
      .max(100),
  })
  .refine(
    (s) => s.total_count <= s.results.length,
    "School calendar response truncated",
  );
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const metadata = <T>(r: ProviderResult<T>) =>
  ({
    status: r.data ? (r.failed ? "STALE" : "AVAILABLE") : "UNAVAILABLE",
    retrievedAt: r.retrievedAt,
    validUntil: r.validUntil,
    issue: r.failed ? "PROVIDER_UNAVAILABLE" : null,
  }) as const;
export type WeekContextService = {
  read(storeId: string, weekStart: string): Promise<WeeklyContext>;
};
export function createWeekContextService(
  database: DatabaseService,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): WeekContextService {
  return {
    async read(storeId, weekStart) {
      const db = await database.getDb(),
        raw = await db.collection("storeContextSettings").findOne({ storeId });
      if (!raw)
        throw new AuthError(
          409,
          "STORE_SETTINGS_NOT_SYNCED",
          "Enregistrez puis synchronisez les réglages du magasin.",
        );
      const { _id, ...payload } = raw;
      void _id;
      const settings = storeContextSettingsSchema.parse(payload),
        cache = new ContextProviderCache(db, fetcher, now),
        weekEnd = addContextDays(weekStart, 6);
      const empty = {
        status: "UNAVAILABLE",
        retrievedAt: null,
        validUntil: null,
        issue: "PROVIDER_UNAVAILABLE",
      } as const;
      const result: WeeklyContext = {
        storeId,
        settingsFingerprint: storeContextFingerprint(settings),
        weekStart,
        weekEnd,
        retrievedAt: now().toISOString(),
        locationLabel: `${settings.city} (${settings.postalCode})`,
        weather: {
          ...empty,
          provider: "MET Norway",
          sourceUrl:
            "https://api.met.no/weatherapi/locationforecast/2.0/documentation",
          issuedAt: null,
          days: [],
        },
        publicHolidays: {
          ...empty,
          provider: "calendrier.api.gouv.fr",
          sourceUrl: "https://calendrier.api.gouv.fr/jours-feries/",
          days: [],
        },
        schoolHolidays: {
          ...empty,
          provider: "Ministère de l’Éducation nationale",
          sourceUrl:
            "https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/",
          zone: settings.schoolZone,
          periods: [],
        },
      };
      // Independent failures: none can block commercial plans or erase other providers.
      await Promise.allSettled([
        (async () => {
          let point: { latitude: number; longitude: number } | null =
              settings.position,
            locationIssue:
              | "CITY_AMBIGUOUS"
              | "CITY_NOT_FOUND"
              | "PROVIDER_UNAVAILABLE"
              | null = null;
          if (settings.locationMode === "CITY") {
            const r = await cache.read(
              `https://geo.api.gouv.fr/communes?${new URLSearchParams({ codePostal: settings.postalCode, fields: "nom,code,centre", format: "json", geometry: "centre" })}`,
              communes,
              86400000,
            );
            const matches =
              r.data?.filter(
                (c) => normalize(c.nom) === normalize(settings.city),
              ) ?? [];
            if (matches.length === 1 && !r.failed) {
              const c = matches[0]!;
              point = {
                longitude: c.centre.coordinates[0],
                latitude: c.centre.coordinates[1],
              };
            } else
              locationIssue = r.failed
                ? "PROVIDER_UNAVAILABLE"
                : matches.length > 1
                  ? "CITY_AMBIGUOUS"
                  : "CITY_NOT_FOUND";
          }
          if (!point) {
            result.weather.issue = locationIssue ?? "CITY_NOT_FOUND";
            return;
          }
          const lat = point.latitude.toFixed(4),
            lon = point.longitude.toFixed(4);
          const r = await cache.read(
            `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
            metForecastSchema,
            3600000,
          );
          result.weather = {
            ...result.weather,
            ...metadata(r),
            issuedAt: r.data
              ? new Date(r.data.properties.meta.updated_at).toISOString()
              : null,
            days: r.data ? forecastDays(r.data, weekStart) : [],
          };
        })(),
        (async () => {
          const years = [
            ...new Set([weekStart.slice(0, 4), weekEnd.slice(0, 4)]),
          ];
          const rs = await Promise.all(
            years.map((y) =>
              cache.read(
                `https://calendrier.api.gouv.fr/jours-feries/metropole/${y}.json`,
                holidays,
                86400000,
              ),
            ),
          );
          if (rs.some((r) => !r.data)) return;
          const latest = rs.reduce((a, b) =>
            (a.retrievedAt ?? "") < (b.retrievedAt ?? "") ? a : b,
          );
          result.publicHolidays = {
            ...result.publicHolidays,
            ...metadata({ ...latest, failed: rs.some((r) => r.failed) }),
            validUntil: rs.map((r) => r.validUntil!).sort()[0]!,
            days: rs
              .flatMap((r) =>
                Object.entries(r.data!)
                  .filter(([d]) => d >= weekStart && d <= weekEnd)
                  .map(([date, label]) => ({ date, label })),
              )
              .sort((a, b) => a.date.localeCompare(b.date)),
          };
        })(),
        (async () => {
          if (!settings.schoolZone) {
            result.schoolHolidays.status = "NOT_CONFIGURED";
            result.schoolHolidays.issue = "ZONE_REQUIRED";
            return;
          }
          const where = `zones = 'Zone ${settings.schoolZone}' AND start_date <= date'${addContextDays(weekEnd, 1)}' AND end_date >= date'${weekStart}'`;
          const r = await cache.read(
            `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?${new URLSearchParams({ where, limit: "100" })}`,
            schools,
            86400000,
          );
          const periods =
            r.data?.results
              .filter((s) => s.zones === `Zone ${settings.schoolZone}`)
              .map((s) => ({
                label: s.description,
                startDate: parisDate(s.start_date),
                resumeDate: parisDate(s.end_date),
                population: s.population,
              }))
              .filter(
                (s) => s.startDate <= weekEnd && s.resumeDate > weekStart,
              ) ?? [];
          const unique = new Map(periods.map((p) => [JSON.stringify(p), p]));
          result.schoolHolidays = {
            ...result.schoolHolidays,
            ...metadata(r),
            periods: [...unique.values()].sort((a, b) =>
              a.startDate.localeCompare(b.startDate),
            ),
          };
        })(),
      ]);
      return weeklyContextSchema.parse(result);
    },
  };
}
