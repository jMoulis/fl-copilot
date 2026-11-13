import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";
import { addContextDays } from "@fl-copilot/domain";

const MAX_COMPRESSED_BYTES = 4_000_000;
const MAX_EXPANDED_BYTES = 32_000_000;
const MAX_ROWS = 500_000;
const MAX_STATION_DAYS = 40_000;
const required = [
  "NUM_POSTE",
  "NOM_USUEL",
  "LAT",
  "LON",
  "ALTI",
  "AAAAMMJJ",
  "TN",
  "QTN",
  "TX",
  "QTX",
  "RR",
  "QRR",
] as const;

/** The publisher's files have one record per physical line. Fail on multiline cells. */
function cells(line: string): string[] {
  if (line.length > 16_384) throw Error("WEATHER_ROW_TOO_LONG");
  const values: string[] = [];
  let value = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += char;
    } else if (char === ";") {
      values.push(value);
      value = "";
      closed = false;
    } else if (char === '"' && value === "" && !closed) quoted = true;
    else if (closed || char === '"') throw Error("WEATHER_CSV_INVALID");
    else value += char;
  }
  if (quoted) throw Error("WEATHER_CSV_INVALID");
  values.push(value);
  return values;
}
function decimal(raw: string): string | null {
  if (!raw) return null;
  if (!/^-?(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(raw))
    throw Error("WEATHER_VALUE_INVALID");
  return raw;
}
export function qualifyWeatherMeasurement(raw: string, code: string) {
  const sourceValue = decimal(raw);
  const quality =
    sourceValue === null
      ? "MISSING"
      : code === "0"
        ? "PROTECTED"
        : code === "1"
          ? "VALIDATED"
          : code === "2"
            ? "SUSPECT"
            : code === "9"
              ? "FILTERED_ONLY"
              : "UNQUALIFIED";
  return {
    sourceValue,
    qualityCode: code || null,
    quality,
    analysisValue:
      sourceValue !== null && (code === "0" || code === "1")
        ? sourceValue
        : null,
  } as const;
}
function date(raw: string): string {
  if (!/^\d{8}$/.test(raw)) throw Error("WEATHER_DATE_INVALID");
  const value = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw Error("WEATHER_DATE_INVALID");
  return value;
}
function coordinate(raw: string, min: number, max: number): number {
  const value = decimal(raw);
  if (value === null || Number(value) < min || Number(value) > max)
    throw Error("WEATHER_STATION_POSITION_INVALID");
  return Number(value);
}

function archiveRows(compressed: Uint8Array) {
  if (!compressed.byteLength || compressed.byteLength > MAX_COMPRESSED_BYTES)
    throw Error("WEATHER_COMPRESSED_SIZE_INVALID");
  const expanded = gunzipSync(compressed, {
    maxOutputLength: MAX_EXPANDED_BYTES,
  });
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(expanded)
    .replace(/^\uFEFF/, "");
  // Bound line count before allocating an array, including on highly compressible input.
  let count = 1;
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n" && ++count > MAX_ROWS + 2)
      throw Error("WEATHER_TOO_MANY_ROWS");
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_ROWS + 2) throw Error("WEATHER_TOO_MANY_ROWS");
  const header = cells(lines[0] ?? "");
  if (
    new Set(header).size !== header.length ||
    required.some((key) => !header.includes(key))
  )
    throw Error("WEATHER_HEADER_INVALID");
  const columns = Object.fromEntries(
    required.map((key) => [key, header.indexOf(key)]),
  ) as Record<(typeof required)[number], number>;
  return { lines, header, columns };
}
export function nearestObservedWeatherStation(
  compressed: Uint8Array,
  point: { latitude: number; longitude: number },
) {
  if (
    !Number.isFinite(point.latitude) ||
    Math.abs(point.latitude) > 90 ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.longitude) > 180
  )
    throw Error("WEATHER_POINT_INVALID");
  const { lines, header, columns } = archiveRows(compressed);
  const stations = new Map<
    string,
    {
      date: string;
      station: {
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        altitudeM: string | null;
      };
    }
  >();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) {
      if (i !== lines.length - 1) throw Error("WEATHER_EMPTY_ROW");
      continue;
    }
    const row = cells(lines[i]!);
    if (row.length !== header.length) throw Error("WEATHER_ROW_INVALID");
    const get = (k: (typeof required)[number]) => row[columns[k]]!;
    if (
      !["TN", "TX", "RR"].some(
        (k) =>
          get(k as (typeof required)[number]) !== "" &&
          ["0", "1"].includes(get(`Q${k}` as (typeof required)[number])),
      )
    )
      continue;
    const id = get("NUM_POSTE"),
      at = date(get("AAAAMMJJ"));
    if (!/^\d{8}$/.test(id)) continue;
    if ((stations.get(id)?.date ?? "") > at) continue;
    stations.set(id, {
      date: at,
      station: {
        id,
        name: get("NOM_USUEL"),
        latitude: coordinate(get("LAT"), -90, 90),
        longitude: coordinate(get("LON"), -180, 180),
        altitudeM: decimal(get("ALTI")),
      },
    });
  }
  const radians = (n: number) => (n * Math.PI) / 180;
  return (
    [...stations.values()]
      .map(({ station }) => {
        const a =
          Math.sin(radians(station.latitude - point.latitude) / 2) ** 2 +
          Math.cos(radians(point.latitude)) *
            Math.cos(radians(station.latitude)) *
            Math.sin(radians(station.longitude - point.longitude) / 2) ** 2;
        return {
          station,
          distanceKm:
            Math.round(6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) * 100) /
            100,
        };
      })
      .sort(
        (a, b) =>
          a.distanceKm - b.distanceKm ||
          a.station.id.localeCompare(b.station.id),
      )[0] ?? null
  );
}

/** Pure source qualification; no store assignment, fetch, cache write or forecast substitution. */
export function parseObservedWeatherSource(
  compressed: Uint8Array,
  stationId: string,
  provenance: { sourceUrl: string; retrievedAt: string },
) {
  if (!/^\d{8}$/.test(stationId)) throw Error("WEATHER_STATION_INVALID");
  const url = new URL(provenance.sourceUrl);
  if (
    url.origin !== "https://meteofrance.s3.sbg.io.cloud.ovh.net" ||
    !/^\/data\/synchro_ftp\/BASE\/QUOT\/Q_(?:\d{2,3}|2[AB])_[a-z]+-\d{4}-\d{4}_RR-T-Vent\.csv\.gz$/.test(
      url.pathname,
    ) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error("WEATHER_SOURCE_INVALID");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      provenance.retrievedAt,
    ) ||
    !Number.isFinite(Date.parse(provenance.retrievedAt)) ||
    new Date(provenance.retrievedAt).toISOString().slice(0, 10) !==
      provenance.retrievedAt.slice(0, 10)
  )
    throw Error("WEATHER_RETRIEVAL_INVALID");
  const years = url.pathname.match(/-(\d{4})-(\d{4})_RR/)!;
  const firstYear = years[1]!,
    lastYear = years[2]!;
  if (firstYear > lastYear) throw Error("WEATHER_SOURCE_RANGE_INVALID");
  const department = url.pathname.match(/Q_(\d{2,3}|2[AB])_/)![1]!;
  if (
    !stationId.startsWith(
      department.startsWith("2") && /[AB]/.test(department) ? "20" : department,
    )
  )
    throw Error("WEATHER_STATION_SOURCE_MISMATCH");
  const { lines, header, columns } = archiveRows(compressed);
  const days = [];
  const dates = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) {
      if (i !== lines.length - 1) throw Error("WEATHER_EMPTY_ROW");
      continue;
    }
    const row = cells(lines[i]!);
    if (row.length !== header.length) throw Error("WEATHER_ROW_INVALID");
    const get = (key: (typeof required)[number]) => row[columns[key]]!;
    if (get("NUM_POSTE") !== stationId) continue;
    const producerDate = date(get("AAAAMMJJ"));
    if (
      producerDate.slice(0, 4) < firstYear ||
      producerDate.slice(0, 4) > lastYear
    )
      throw Error("WEATHER_DATE_OUTSIDE_SOURCE_RANGE");
    if (producerDate > provenance.retrievedAt.slice(0, 10))
      throw Error("WEATHER_FUTURE_OBSERVATION");
    if (dates.has(producerDate)) throw Error("WEATHER_DUPLICATE_DATE");
    dates.add(producerDate);
    if (dates.size > MAX_STATION_DAYS)
      throw Error("WEATHER_TOO_MANY_STATION_DAYS");
    const name = get("NOM_USUEL");
    if (!name.trim() || name.length > 150)
      throw Error("WEATHER_STATION_NAME_INVALID");
    const measurements = {
      TN: qualifyWeatherMeasurement(get("TN"), get("QTN")),
      TX: qualifyWeatherMeasurement(get("TX"), get("QTX")),
      RR: qualifyWeatherMeasurement(get("RR"), get("QRR")),
    };
    if (
      measurements.RR.sourceValue !== null &&
      Number(measurements.RR.sourceValue) < 0
    )
      throw Error("WEATHER_RAIN_INVALID");
    const tn = measurements.TN.analysisValue,
      tx = measurements.TX.analysisValue;
    if (tn !== null && tx !== null && Number(tn) > Number(tx))
      throw Error("WEATHER_EXTREMA_INVALID");
    days.push({
      producerDate,
      station: {
        id: stationId,
        name,
        latitude: coordinate(get("LAT"), -90, 90),
        longitude: coordinate(get("LON"), -180, 180),
        altitudeM: decimal(get("ALTI")),
      },
      measurements,
      sourceRow: i + 1,
      temperatureUnit: "C" as const,
      rainfallUnit: "mm" as const,
      temperatureWindow: "PRODUCER_DAILY_EXTREMA" as const,
      // Only qualify metropolitan UTC rainfall here; no overseas FU assumption.
      rainfallWindow:
        department.length === 2
          ? {
              from: `${producerDate}T06:00:00.000Z`,
              to: `${addContextDays(producerDate, 1)}T06:00:00.000Z`,
              dateAttribution: "PRODUCER_DATE" as const,
            }
          : null,
    });
  }
  return {
    type: "OBSERVED_STATION_DAILY" as const,
    provider: "Météo-France" as const,
    ...provenance,
    sourceSha256: createHash("sha256").update(compressed).digest("hex"),
    publicationDate: null,
    days: days.sort((a, b) => a.producerDate.localeCompare(b.producerDate)),
  };
}
