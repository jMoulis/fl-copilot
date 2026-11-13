import { DOMParser } from "@xmldom/xmldom";
import {
  economicContextSchema,
  economicDataSchema,
  economicDataUrl,
  economicSeriesIds,
  economicMonthSchema,
  shiftEconomicMonth,
  parisDate,
  type EconomicContext,
} from "@fl-copilot/domain";
import type { ContextProviderCache } from "./provider-cache.js";

export function parseInseeMonthly(xml: string, start: string, end: string) {
  economicMonthSchema.parse(start);
  economicMonthSchema.parse(end);
  if (start > end || shiftEconomicMonth(start, 17) < end)
    throw Error("INSEE_RANGE_INVALID");
  if (Buffer.byteLength(xml) > 256_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("INSEE_XML_INVALID");
  const doc = new DOMParser({
    onError() {
      throw Error("INSEE_XML_INVALID");
    },
  }).parseFromString(xml, "text/xml");
  if (
    doc.documentElement?.localName !== "StructureSpecificData" ||
    doc.documentElement.namespaceURI !==
      "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message"
  )
    throw Error("INSEE_XML_INVALID");
  const all = Array.from(doc.getElementsByTagNameNS("*", "Series"));
  if (!all.length || all.length > 2) throw Error("INSEE_SERIES_INVALID");
  const known = new Set<string>();
  for (const item of all) {
    const id = item.getAttribute("IDBANK");
    if (
      !id ||
      !economicSeriesIds.includes(id as (typeof economicSeriesIds)[number]) ||
      known.has(id)
    )
      throw Error("INSEE_SERIES_INVALID");
    known.add(id);
    if (
      item.getAttribute("FREQ") !== "M" ||
      item.getAttribute("UNIT_MEASURE") !== "SO" ||
      item.getAttribute("UNIT_MULT") !== "0" ||
      item.getAttribute("REF_AREA") !== "FM"
    )
      throw Error("INSEE_UNIT_CHANGED");
    const title = item.getAttribute("TITLE_FR") ?? "";
    if (
      id === "011813720"
        ? !/Base 2025.*Alimentation/.test(title)
        : !/confiance des ménages/.test(title)
    )
      throw Error("INSEE_DEFINITION_CHANGED");
  }
  return economicDataSchema.parse({
    series: economicSeriesIds.map((id) => {
      const s = all.find((s) => s.getAttribute("IDBANK") === id);
      const points = s
        ? Array.from(s.getElementsByTagNameNS("*", "Obs"))
            .map((o) => {
              const raw = o.getAttribute("OBS_VALUE"),
                observationStatus = o.getAttribute("OBS_STATUS") ?? "",
                quality = o.getAttribute("OBS_QUAL") ?? "";
              if (
                raw === null ||
                (raw !== "NaN" &&
                  !/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(raw))
              )
                throw Error("INSEE_VALUE_INVALID");
              return {
                period: economicMonthSchema.parse(
                  o.getAttribute("TIME_PERIOD"),
                ),
                value: raw === "NaN" || observationStatus !== "A" ? null : raw,
                observationStatus,
                quality,
                revised: o.getAttribute("OBS_REV") === "1",
              };
            })
            .filter((p) => p.period && p.period >= start && p.period <= end)
            .sort((a, b) => a.period!.localeCompare(b.period!))
        : [];
      return {
        id,
        lastUpdated: s?.getAttribute("LAST_UPDATE") ?? null,
        points,
      };
    }),
  });
}
async function boundedXml(response: Response) {
  if (
    Number(response.headers.get("content-length")) > 256_000 ||
    !response.body
  )
    throw Error("INSEE_RESPONSE_INVALID");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000) {
        await reader.cancel();
        throw Error("INSEE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function readEconomicContext(
  cache: ContextProviderCache,
  weekStart: string,
  weekEnd: string,
  now: Date,
): Promise<EconomicContext> {
  const start = shiftEconomicMonth(weekStart.slice(0, 7), -15),
    end = [
      weekEnd.slice(0, 7),
      parisDate(now.toISOString()).slice(0, 7),
    ].sort()[0]!;
  const empty: EconomicContext = {
    status: "UNAVAILABLE",
    provider: "Insee",
    sourceUrl: economicDataUrl,
    retrievedAt: null,
    validUntil: null,
    issue: "PROVIDER_UNAVAILABLE",
    vintage: "CURRENT_REVISED",
    historicalPublicationDatesKnown: false,
    series: [],
  };
  if (start > end) return { ...empty, issue: null };
  const url = `${economicDataUrl}?${new URLSearchParams({ startPeriod: start, endPeriod: end })}`;
  const r = await cache.read(url, economicDataSchema, 24 * 60 * 60_000, {
    accept: "application/vnd.sdmx.structurespecificdata+xml;version=2.1",
    respectExpires: false,
    decode: async (response) =>
      parseInseeMonthly(await boundedXml(response), start, end),
  });
  return economicContextSchema.parse({
    ...empty,
    status: r.data ? (r.failed ? "STALE" : "AVAILABLE") : "UNAVAILABLE",
    retrievedAt: r.retrievedAt,
    validUntil: r.validUntil,
    issue: r.failed ? "PROVIDER_UNAVAILABLE" : null,
    series: r.data?.series ?? [],
  });
}
