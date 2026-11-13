import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  transportContextSchema,
  transportDisruptionSchema,
  parisDate,
  type StoreContextSettings,
  type TransportContext,
} from "@fl-copilot/domain";
import { ContextProviderCache } from "./provider-cache.js";
import { boundedJson } from "./transports.js";
import { plainText } from "./journal-sources.js";
export const primTrafficBase =
  "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/line_reports/lines/";
const weekdayLabels: Record<string, string> = {
  monday: "lundi",
  tuesday: "mardi",
  wednesday: "mercredi",
  thursday: "jeudi",
  friday: "vendredi",
  saturday: "samedi",
  sunday: "dimanche",
};
const localTime = z
  .string()
  .regex(/^\d{8}T(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/)
  .refine(
    (s) =>
      z.iso
        .date()
        .safeParse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
        .success,
  );
const period = z
  .object({ begin: localTime, end: localTime })
  .refine((p) => p.begin < p.end);
const link = z.object({ type: z.string(), id: z.string() });
const rawSchema = z.object({
  pagination: z
    .object({
      total_result: z.number().int().nonnegative(),
      items_on_page: z.number().int().nonnegative(),
    })
    .optional(),
  line_reports: z
    .array(
      z.object({
        line: z.object({ id: z.string(), links: z.array(link).optional() }),
        pt_objects: z.array(z.unknown()).max(500).optional(),
      }),
    )
    .max(100),
  disruptions: z
    .array(
      z.object({
        id: z.string().max(200),
        messages: z.array(z.object({ text: z.string().max(16000) })).max(30),
        severity: z.object({ effect: z.string().max(80) }).optional(),
        application_periods: z.array(period).max(100),
        updated_at: localTime.optional(),
        application_patterns: z
          .array(
            z.object({
              application_period: z.object({
                begin: z.string().regex(/^\d{8}$/),
                end: z.string().regex(/^\d{8}$/),
              }),
              week_pattern: z.record(z.string(), z.boolean()),
              time_slots: z
                .array(
                  z.object({
                    begin: z.string().regex(/^\d{6}$/),
                    end: z.string().regex(/^\d{6}$/),
                  }),
                )
                .max(20)
                .optional(),
            }),
          )
          .max(32)
          .optional(),
      }),
    )
    .max(200),
});
const dataSchema = z
  .object({
    disruptions: z.array(transportDisruptionSchema).max(8),
    partial: z.boolean(),
  })
  .strict();
function disruptionRefs(
  value: unknown,
  depth = 0,
): Array<{ type: string; id: string }> {
  if (depth > 4 || !value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const links = Array.isArray(record.links)
    ? record.links.flatMap((raw) => {
        const parsed = link.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  for (const key of ["line", "stop_area", "stop_point", "network", "route"]) {
    if (record[key]) links.push(...disruptionRefs(record[key], depth + 1));
  }
  return links;
}
export function normalizeTraffic(raw: unknown, lineId: string) {
  const r = rawSchema.parse(raw);
  const report = r.line_reports.filter((l) => l.line.id === `line:${lineId}`);
  if (!report.length) {
    if (
      r.line_reports.length === 0 &&
      r.disruptions.length === 0 &&
      r.pagination?.total_result === 0
    )
      return { disruptions: [], partial: false };
    throw Error("TRANSPORT_LINE_NOT_CONFIRMED");
  }
  const ids = new Set(
    report
      .flatMap((l) => [
        ...(l.line.links ?? []),
        ...(l.pt_objects ?? []).flatMap((p) => disruptionRefs(p)),
      ])
      .filter((l) => l.type === "disruption")
      .map((l) => l.id),
  );
  if (!ids.size && r.disruptions.length && r.line_reports.length === 1)
    throw Error("TRANSPORT_LINKS_UNVERIFIED");
  const disruptions = r.disruptions.filter((d) => ids.has(d.id));
  if ([...ids].some((id) => !disruptions.some((d) => d.id === id)))
    throw Error("TRANSPORT_DISRUPTION_MISSING");
  const format = (t: string) =>
    t.length === 8
      ? `${t.slice(6, 8)}/${t.slice(4, 6)}/${t.slice(0, 4)}`
      : `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  return dataSchema.parse({
    partial:
      disruptions.length > 8 ||
      (!!r.pagination &&
        r.pagination.total_result > r.pagination.items_on_page) ||
      disruptions.some(
        (d) =>
          d.application_periods.length > 32 ||
          d.messages.map((m) => plainText(m.text)).join(" · ").length > 700 ||
          (d.application_patterns?.length ?? 0) > 4,
      ),
    disruptions: disruptions.slice(0, 8).map((d) => ({
      id: d.id,
      message: d.messages
        .map((m) => plainText(m.text))
        .join(" · ")
        .slice(0, 700),
      effect: d.severity?.effect ?? null,
      applicationPeriods: d.application_periods.slice(0, 32),
      updatedAt: d.updated_at ?? null,
      schedule: d.application_patterns?.length
        ? d.application_patterns
            .slice(0, 4)
            .map(
              (p) =>
                `${format(p.application_period.begin)}–${format(p.application_period.end)} ; ${Object.entries(
                  p.week_pattern,
                )
                  .filter(([, v]) => v)
                  .map(([k]) => weekdayLabels[k] ?? "jour non précisé")
                  .join(
                    ", ",
                  )} ; ${(p.time_slots ?? []).map((t) => `${format(t.begin)}–${format(t.end)}`).join(", ") || "journée entière selon la source"}`,
            )
            .join(" | ")
            .slice(0, 600)
        : null,
    })),
  });
}
type Snapshot = {
  url: string;
  snapshotOf: string;
  revision: string;
  firstCapturedAt: string;
  payload: unknown;
};
export async function readTransportContext(
  db: Db,
  settings: StoreContextSettings,
  weekEnd: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<TransportContext | "NOT_CONFIGURED"> {
  const profile = settings.transports;
  if (!profile) return "NOT_CONFIGURED";
  const base: TransportContext = {
    status: "NOT_CONFIGURED",
    issue: null,
    radiusMetres: profile.radiusMetres,
    lines: [],
  };
  const locationChanged =
    profile.city !== settings.city ||
    profile.postalCode !== settings.postalCode ||
    (profile.location.source === "STORE_GPS" &&
      (!settings.position ||
        settings.locationMode !== "POINT" ||
        settings.position.latitude !== profile.location.latitude ||
        settings.position.longitude !== profile.location.longitude));
  if (locationChanged) return { ...base, issue: "LOCATION_CHANGED" };
  const selected = profile.lines.filter((l) => l.enabled);
  if (!selected.length) return { ...base, issue: "NO_SELECTED_LINES" };
  if (!apiKey) return { ...base, issue: "MISSING_API_KEY" };
  const cache = new ContextProviderCache(
    db,
    async (input, init) => {
      if (typeof input !== "string" || !input.startsWith(primTrafficBase))
        throw Error("TRANSPORT_HOST_INVALID");
      return fetcher(input, {
        ...init,
        redirect: "error",
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          apikey: apiKey,
        },
      });
    },
    now,
  );
  const collection = db.collection<Snapshot>("contextProviderCache");
  const lines: TransportContext["lines"] = [];
  for (let offset = 0; offset < selected.length; offset += 4) {
    lines.push(
      ...(await Promise.all(
        selected.slice(offset, offset + 4).map(async (line) => {
          const empty: TransportContext["lines"][number] = {
            id: line.id,
            name: `${line.mode} ${line.name}`.slice(0, 100),
            stopName: line.stopName,
            distanceMetres: line.distanceMetres,
            status: "UNAVAILABLE",
            retrievedAt: null,
            validUntil: null,
            capturedAt: null,
            disruptions: [],
            partial: false,
          };
          try {
            const url = `${primTrafficBase}${encodeURIComponent(`line:${line.id}`)}/line_reports?count=100`;
            const result = await cache.read(url, dataSchema, 30 * 60000, {
              accept: "application/json",
              respectExpires: false,
              decode: async (r) =>
                normalizeTraffic(await boundedJson(r), line.id),
            });
            if (result.data && !result.failed && result.retrievedAt) {
              const revision = createHash("sha256")
                  .update(JSON.stringify(result.data))
                  .digest("hex"),
                key = `journal-snapshot:${url}:${result.retrievedAt.slice(0, 10)}:${revision}`;
              try {
                await collection.updateOne(
                  { url: key },
                  {
                    $setOnInsert: {
                      url: key,
                      snapshotOf: url,
                      revision,
                      firstCapturedAt: result.retrievedAt,
                      payload: result.data,
                    },
                  },
                  { upsert: true },
                );
              } catch (e) {
                if (!(
                  typeof e === "object" &&
                  e !== null &&
                  "code" in e &&
                  e.code === 11000
                ))
                  throw e;
              }
            }
            const at = now(),
              past = weekEnd < parisDate(at.toISOString());
            const snapshots = await collection
              .find({
                snapshotOf: url,
                ...(past
                  ? {
                      firstCapturedAt: {
                        $lt: new Date(
                          Date.parse(`${weekEnd}T00:00:00Z`) + 86400000,
                        ).toISOString(),
                      },
                    }
                  : {}),
              })
              .sort({ firstCapturedAt: -1 })
              .limit(40)
              .toArray();
            const row = snapshots.find(
                (s) => !past || parisDate(s.firstCapturedAt) <= weekEnd,
              ),
              data = dataSchema.safeParse(row?.payload);
            if (!row || !data.success) return empty;
            const seenDays = new Set<string>();
            const history = snapshots
              .flatMap((s) => {
                const parsed = dataSchema.safeParse(s.payload),
                  day = parisDate(s.firstCapturedAt);
                if (
                  !parsed.success ||
                  seenDays.has(day) ||
                  (past && day > weekEnd)
                )
                  return [];
                seenDays.add(day);
                return [
                  {
                    capturedAt: s.firstCapturedAt,
                    disruptions: parsed.data.disruptions
                      .slice(0, 3)
                      .map((d) => ({ ...d, message: d.message.slice(0, 400) })),
                    partial:
                      parsed.data.partial ||
                      parsed.data.disruptions.length > 3 ||
                      parsed.data.disruptions.some(
                        (d) => d.message.length > 400,
                      ),
                  },
                ];
              })
              .slice(0, 7);
            return {
              ...empty,
              history,
              status:
                past || result.failed
                  ? ("STALE" as const)
                  : ("AVAILABLE" as const),
              retrievedAt: result.retrievedAt,
              validUntil: result.validUntil,
              capturedAt: row.firstCapturedAt,
              ...data.data,
            };
          } catch {
            return empty;
          }
        }),
      )),
    );
  }
  const available = lines.some((l) => l.status !== "UNAVAILABLE");
  return transportContextSchema.parse({
    ...base,
    status: available
      ? lines.some((l) => l.status !== "AVAILABLE")
        ? "STALE"
        : "AVAILABLE"
      : "UNAVAILABLE",
    issue: available
      ? null
      : weekEnd < parisDate(now().toISOString())
        ? "HISTORY_UNAVAILABLE"
        : "PROVIDER_UNAVAILABLE",
    lines,
  });
}
