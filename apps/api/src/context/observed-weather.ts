import { z } from "zod";
import {
  observedWeatherContextSchema,
  observedWeatherSourceUrl,
  parisDate,
  type ObservedWeatherContext,
} from "@fl-copilot/domain";
import { ContextProviderCache, type ProviderResult } from "./provider-cache.js";
import {
  nearestObservedWeatherStation,
  parseObservedWeatherSource,
} from "./observed-weather-source.js";

const catalogUrl =
  "https://www.data.gouv.fr/api/1/datasets/donnees-climatologiques-de-base-quotidiennes/";
const catalog = z.object({
  resources: z.array(z.object({ url: z.string().max(1000) })).max(2000),
});
const archive = z.object({
  base64: z.string().max(5_333_336),
  downloadedAt: z.iso.datetime(),
});
const archivePattern =
  /^https:\/\/meteofrance\.s3\.sbg\.io\.cloud\.ovh\.net\/data\/synchro_ftp\/BASE\/QUOT\/Q_(\d{2}|2[AB])_[a-z]+-(\d{4})-(\d{4})_RR-T-Vent\.csv\.gz$/;
async function bounded(response: Response, max: number) {
  if (Number(response.headers.get("content-length")) > max || !response.body)
    throw Error("WEATHER_RESPONSE_TOO_LARGE");
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw Error("WEATHER_RESPONSE_TOO_LARGE");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}
function resource(urls: string[], department: string, year: number) {
  return urls
    .flatMap((url) => {
      const m = url.match(archivePattern);
      return m &&
        m[1] === department &&
        Number(m[2]) <= year &&
        Number(m[3]) >= year
        ? [{ url, span: Number(m[3]) - Number(m[2]) }]
        : [];
    })
    .sort((a, b) => a.span - b.span || a.url.localeCompare(b.url))[0]?.url;
}
export function emptyObservedWeather(
  issue: ObservedWeatherContext["issue"],
): ObservedWeatherContext {
  return {
    status: "UNAVAILABLE",
    provider: "Météo-France",
    sourceUrl: observedWeatherSourceUrl,
    retrievedAt: null,
    validUntil: null,
    issue,
    selection: "AUTO_DEPARTMENT_NEAREST",
    reference: null,
    publicationDatesKnown: false,
    days: [],
  };
}
/** Shared public archives; no business data or raw files sent to the model/mobile. */
export async function readObservedWeather(
  cache: ContextProviderCache,
  point: { latitude: number; longitude: number },
  department: string,
  weekStart: string,
  weekEnd: string,
  now: Date,
): Promise<ObservedWeatherContext> {
  const today = parisDate(now.toISOString());
  if (weekStart >= today) return emptyObservedWeather("PERIOD_NOT_OBSERVED");
  if (
    !/^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB])$/.test(department) ||
    department === "20"
  )
    return emptyObservedWeather("UNSUPPORTED_REGION");
  const c = await cache.read(catalogUrl, catalog, 86400000, {
    accept: "application/json",
    respectExpires: false,
    decode: async (r) =>
      JSON.parse((await bounded(r, 2_000_000)).toString("utf8")),
  });
  if (!c.data) return emptyObservedWeather("PROVIDER_UNAVAILABLE");
  const urls = c.data.resources.map((r) => r.url),
    referenceUrl = resource(urls, department, Number(today.slice(0, 4)));
  if (!referenceUrl) return emptyObservedWeather("NO_ARCHIVE");
  const reads = new Map<
    string,
    Promise<ProviderResult<z.infer<typeof archive>>>
  >();
  const load = (url: string) => {
    if (!reads.has(url))
      reads.set(
        url,
        cache.read(url, archive, 86400000, {
          accept: "application/gzip",
          respectExpires: false,
          decode: async (r) => {
            const bytes = await bounded(r, 4_000_000),
              downloadedAt = now.toISOString();
            const ref = nearestObservedWeatherStation(bytes, point);
            if (ref)
              parseObservedWeatherSource(bytes, ref.station.id, {
                sourceUrl: url,
                retrievedAt: downloadedAt,
              });
            return { base64: bytes.toString("base64"), downloadedAt };
          },
        }),
      );
    return reads.get(url)!;
  };
  const recent = await load(referenceUrl);
  if (!recent.data) return emptyObservedWeather("PROVIDER_UNAVAILABLE");
  const reference = nearestObservedWeatherStation(
    Buffer.from(recent.data.base64, "base64"),
    point,
  );
  if (!reference) return emptyObservedWeather("NO_STATION");
  const years = [
    ...new Set([
      weekStart.slice(0, 4),
      [weekEnd, today].sort()[0]!.slice(0, 4),
    ]),
  ];
  const requested = years.map((y) => resource(urls, department, Number(y)));
  const days: ObservedWeatherContext["days"] = [];
  const missing = requested.some((u) => !u);
  let failed = c.failed || recent.failed;
  for (const url of new Set(requested.filter((u): u is string => !!u))) {
    const r = await load(url);
    if (!r.data) {
      failed = true;
      continue;
    }
    failed ||= r.failed;
    const parsed = parseObservedWeatherSource(
      Buffer.from(r.data.base64, "base64"),
      reference.station.id,
      { sourceUrl: url, retrievedAt: r.data.downloadedAt },
    );
    for (const day of parsed.days) {
      if (
        day.producerDate < weekStart ||
        day.producerDate > weekEnd ||
        day.producerDate >= today ||
        !day.rainfallWindow ||
        day.rainfallWindow.to > r.data.downloadedAt
      )
        continue;
      days.push({
        ...day,
        rainfallWindow: day.rainfallWindow,
        sourceUrl: url,
        sourceSha256: parsed.sourceSha256,
        sourceRetrievedAt: r.data.downloadedAt,
      });
    }
  }
  const results = await Promise.all(reads.values()),
    sources = [c, ...results];
  return observedWeatherContextSchema.parse({
    ...emptyObservedWeather(null),
    reference,
    status: failed ? "STALE" : "AVAILABLE",
    issue: failed ? "PROVIDER_UNAVAILABLE" : missing ? "NO_ARCHIVE" : null,
    retrievedAt:
      sources
        .flatMap((r) => (r.retrievedAt ? [r.retrievedAt] : []))
        .sort()[0] ?? null,
    validUntil:
      sources.flatMap((r) => (r.validUntil ? [r.validUntil] : [])).sort()[0] ??
      null,
    days: [...new Map(days.map((d) => [d.producerDate, d])).values()].sort(
      (a, b) => a.producerDate.localeCompare(b.producerDate),
    ),
  });
}
