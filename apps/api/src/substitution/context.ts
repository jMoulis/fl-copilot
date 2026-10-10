import { z } from "zod";
import { storeContextSettingsSchema } from "@fl-copilot/domain";
import type { EvidenceContext } from "@fl-copilot/substitution-core";
const holidays = z.record(z.string().date(), z.string().min(1));
const schools = z
  .object({
    total_count: z.number().int().nonnegative(),
    results: z
      .array(
        z.object({
          start_date: z.string().datetime({ offset: true }),
          end_date: z.string().datetime({ offset: true }),
          zones: z.string(),
        }),
      )
      .max(100),
  })
  .refine((s) => s.total_count <= s.results.length);
export type EvidenceCache = {
  _id: unknown;
  url: string;
  data?: unknown;
  validUntil?: string;
};
export function evidenceCachedContext(
  rows: EvidenceCache[],
  settings: unknown,
  dates: string[],
  now: string,
): Omit<EvidenceContext, "operations"> {
  const holidayDates: string[] = [],
    schoolHolidayDates: string[] = [],
    sourceIds: string[] = [],
    holidayCovered = new Set<string>(),
    schoolCovered = new Set<string>(),
    configuration = storeContextSettingsSchema.safeParse(settings);
  for (const row of rows) {
    let url: URL;
    try {
      url = new URL(row.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    if (url.hostname === "api.met.no") {
      continue;
    } // forecasts are inspected, never used as observed weather
    if (!row.validUntil || row.validUntil < now) continue;
    const annual = /^\/jours-feries\/metropole\/(\d{4})\.json$/.exec(
      url.pathname,
    );
    if (url.hostname === "calendrier.api.gouv.fr" && annual) {
      const parsed = holidays.safeParse(row.data);
      if (!parsed.success) continue;
      for (const d of dates)
        if (d.startsWith(annual[1]!)) {
          holidayCovered.add(d);
          if (parsed.data[d]) holidayDates.push(d);
        }
      sourceIds.push(String(row._id));
    }
    if (
      url.hostname !== "data.education.gouv.fr" ||
      url.pathname !==
        "/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records" ||
      !configuration.success ||
      !configuration.data.schoolZone
    )
      continue;
    const query =
      /^zones = 'Zone ([ABC])' AND start_date <= date'(\d{4}-\d{2}-\d{2})' AND end_date >= date'(\d{4}-\d{2}-\d{2})'$/.exec(
        url.searchParams.get("where") ?? "",
      );
    if (!query || query[1] !== configuration.data.schoolZone) continue;
    const parsed = schools.safeParse(row.data);
    if (!parsed.success) continue;
    for (const d of dates) {
      if (d < query[3]! || d >= query[2]!) continue;
      schoolCovered.add(d);
      if (
        parsed.data.results.some(
          (p) =>
            p.zones === `Zone ${query[1]}` &&
            d >= p.start_date.slice(0, 10) &&
            d < p.end_date.slice(0, 10),
        )
      )
        schoolHolidayDates.push(d);
    }
    sourceIds.push(String(row._id));
  }
  const coverage = (set: Set<string>) =>
    dates.length && dates.every((d) => set.has(d))
      ? ("KNOWN" as const)
      : set.size
        ? ("PARTIAL" as const)
        : ("UNKNOWN" as const);
  return {
    sourceIds: [...new Set(sourceIds)].sort(),
    holidayDates: [...new Set(holidayDates)].sort(),
    schoolHolidayDates: [...new Set(schoolHolidayDates)].sort(),
    publicHolidayCoverage: coverage(holidayCovered),
    schoolHolidayCoverage: coverage(schoolCovered),
  };
}
