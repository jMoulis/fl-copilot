import { z } from "zod";
import { transportContextSchema } from "./store-transports";
const date = z.iso.date();
export const journalConsumptionSchema = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    reportUrl: z
      .string()
      .url()
      .startsWith("https://www.franceagrimer.fr/")
      .nullable()
      .default(null),
    editionLabel: z.string().max(180).nullable().default(null),
    groups: z
      .array(
        z
          .object({
            group: z.enum(["FRUITS", "VEGETABLES"]),
            quantityKgPerHousehold: z.number().finite().nonnegative(),
            quantityAnnualPercent: z.number().finite(),
            averagePriceEurPerKg: z.number().finite().nonnegative(),
            priceAnnualPercent: z.number().finite(),
          })
          .strict(),
      )
      .length(2),
  })
  .strict()
  .refine((s) => new Set(s.groups.map((g) => g.group)).size === 2);
export const journalSourcePayloadSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            publishedAt: z.iso.datetime().nullable().optional(),
            scopeLabel: z.string().max(420).optional(),
            title: z.string().min(1).max(180),
            summary: z.string().max(420),
            sourceUrl: z.string().url().startsWith("https://"),
            periodLabel: z.string().max(180),
            startDate: date.nullable(),
            endDate: date.nullable(),
          })
          .strict()
          .refine(
            (s) => !s.startDate || !s.endDate || s.startDate <= s.endDate,
          ),
      )
      .max(12),
    consumption: journalConsumptionSchema.nullable(),
  })
  .strict();
export const journalSourceSchema = z
  .object({
    kind: z.enum([
      "WORKS",
      "AGENDA",
      "CONSUMPTION",
      "NATIONAL_SOCIAL",
      "NATIONAL_RESTRICTIONS",
    ]),
    status: z.enum(["AVAILABLE", "STALE", "UNAVAILABLE", "NOT_CONFIGURED"]),
    provider: z.string().min(1).max(100),
    sourceUrl: z.string().url().startsWith("https://"),
    retrievedAt: z.iso.datetime().nullable(),
    validUntil: z.iso.datetime().nullable(),
    firstCapturedAt: z.iso.datetime().nullable(),
    revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    issue: z
      .enum([
        "PROVIDER_UNAVAILABLE",
        "HISTORY_UNAVAILABLE",
        "LOCATION_NOT_SUPPORTED",
      ])
      .nullable(),
    payload: journalSourcePayloadSchema.nullable(),
    history: z
      .array(
        z
          .object({
            revision: z.string().regex(/^[a-f0-9]{64}$/),
            firstCapturedAt: z.iso.datetime(),
            payload: journalSourcePayloadSchema,
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const journalContextSchema = z
  .object({
    sources: z.array(journalSourceSchema).length(3),
    national: z
      .array(journalSourceSchema)
      .max(2)
      .refine(
        (rows) =>
          rows.every(
            (s) =>
              s.kind === "NATIONAL_SOCIAL" ||
              s.kind === "NATIONAL_RESTRICTIONS",
          ) && new Set(rows.map((s) => s.kind)).size === rows.length,
      )
      .optional(),
    transport: z.union([z.literal("NOT_CONFIGURED"), transportContextSchema]),
  })
  .strict()
  .refine((s) => new Set(s.sources.map((p) => p.kind)).size === 3);
export type JournalContext = z.infer<typeof journalContextSchema>;
export type JournalSource = z.infer<typeof journalSourceSchema>;
export type JournalSourcePayload = z.infer<typeof journalSourcePayloadSchema>;
/** A date filter never invents a date for an undated announcement. */
export function journalItemsForPeriod(
  source: JournalSource,
  startDate: string,
  endDate: string,
) {
  return (
    source.payload?.items.filter(
      (i) =>
        (!i.startDate || i.startDate <= endDate) &&
        (!i.endDate || i.endDate >= startDate),
    ) ?? []
  );
}
export function journalItemsForDate(source: JournalSource, date: string) {
  return journalItemsForPeriod(source, date, date);
}

/** Historical local views never relabel later collected announcements as known facts. */
export function journalSourceForDate(
  source: JournalSource,
  date: string,
  today: string,
): JournalSource {
  if (
    source.kind === "CONSUMPTION" ||
    date >= today ||
    source.status === "NOT_CONFIGURED"
  )
    return source;
  const throughDate = (s: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(s));
  const history = source.history.filter(
    (h) => throughDate(h.firstCapturedAt) <= date,
  );
  const selected = history[0];
  return {
    ...source,
    status: selected ? "STALE" : "UNAVAILABLE",
    payload: selected?.payload ?? null,
    revision: selected?.revision ?? null,
    firstCapturedAt: selected?.firstCapturedAt ?? null,
    issue: selected ? null : "HISTORY_UNAVAILABLE",
    history,
  };
}

/** Bounded archived selection, never today's source retroactively applied to a past day.
 * Undated announcements are recent reading material, not dated business observations. */
export function nationalNewsForPeriod(
  context: JournalContext,
  start: string,
  end: string,
  today: string,
) {
  const seen = new Set<string>();
  const earliest = new Date(Date.parse(`${start}T12:00:00Z`) - 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  return (context.national ?? [])
    .flatMap((raw) => {
      const source = journalSourceForDate(
        raw,
        end < today ? end : today,
        today,
      );
      return (source.payload?.items ?? []).flatMap((item) => {
        const published = item.publishedAt
          ? new Intl.DateTimeFormat("en-CA", {
              timeZone: "Europe/Paris",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(item.publishedAt))
          : undefined;
        const dated = !!item.startDate && !!item.endDate;
        const include = dated
          ? item.startDate! <= end && item.endDate! >= start
          : !!published &&
            published >= earliest &&
            published <= end &&
            published <= today;
        if (!include || seen.has(item.sourceUrl)) return [];
        seen.add(item.sourceUrl);
        return [{ item, source, dated }];
      });
    })
    .sort(
      (a, b) =>
        Number(b.dated) - Number(a.dated) ||
        (b.item.publishedAt ?? "").localeCompare(a.item.publishedAt ?? ""),
    )
    .slice(0, 3);
}
