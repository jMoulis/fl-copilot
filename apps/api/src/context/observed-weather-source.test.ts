import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseObservedWeatherSource,
  qualifyWeatherMeasurement,
} from "./observed-weather-source";

const url = (dep: string) =>
  `https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_${dep}_latest-2025-2026_RR-T-Vent.csv.gz`;
const provenance = {
  sourceUrl: url("75"),
  retrievedAt: "2026-11-12T18:10:17.464Z",
};
const fixture = (dep = "75") =>
  readFileSync(
    new URL(
      `../../../../scripts/fixtures/meteofrance-${dep}-sample.csv`,
      import.meta.url,
    ),
    "utf8",
  );
const parse = (text: string, station = "75110001") =>
  parseObservedWeatherSource(gzipSync(text), station, provenance);
const header = "NUM_POSTE;NOM_USUEL;LAT;LON;ALTI;AAAAMMJJ;TN;QTN;TX;QTX;RR;QRR";
const row =
  "75110001;LARIBOISIERE;48.882833;2.352000;55;20261001;4.9;1;9.0;1;0;1";
const csv = (record = row) => `${header}\n${record}\n`;

describe("Météo-France observed daily source qualification", () => {
  it("retains actual source values, position, row, gzip hash and measurement windows", () => {
    const compressed = gzipSync(fixture());
    const result = parseObservedWeatherSource(
      compressed,
      "75110001",
      provenance,
    );
    expect(result).toMatchObject({
      type: "OBSERVED_STATION_DAILY",
      provider: "Météo-France",
      ...provenance,
      publicationDate: null,
      sourceSha256: createHash("sha256").update(compressed).digest("hex"),
    });
    expect(result.days).toHaveLength(3);
    expect(result.days[0]).toMatchObject({
      producerDate: "2025-10-01",
      sourceRow: 2,
      station: {
        id: "75110001",
        name: "LARIBOISIERE",
        latitude: 48.882833,
        longitude: 2.352,
        altitudeM: "55",
      },
      temperatureUnit: "C",
      rainfallUnit: "mm",
      temperatureWindow: "PRODUCER_DAILY_EXTREMA",
      rainfallWindow: {
        from: "2025-10-01T06:00:00.000Z",
        to: "2025-10-02T06:00:00.000Z",
      },
    });
    expect(result.days[0]!.measurements).toMatchObject({
      TN: { analysisValue: "11.7" },
      TX: { analysisValue: "19.8" },
      RR: { analysisValue: "0.0" },
    });
    expect(result).not.toHaveProperty("storeId");
    expect(result).not.toHaveProperty("stationApprovedForStore");
  });
  it("reads the second candidate independently and never manufactures an absent station", () => {
    const result = parseObservedWeatherSource(
      gzipSync(fixture("92")),
      "92073001",
      { ...provenance, sourceUrl: url("92") },
    );
    expect(result.days).toHaveLength(3);
    expect(result.days[0]!.station).toMatchObject({
      name: "SURESNES",
      latitude: 48.870667,
      longitude: 2.2345,
    });
    expect(result.days[0]!.measurements).toMatchObject({
      TN: { analysisValue: "8.8" },
      TX: { analysisValue: "20.7" },
      RR: { analysisValue: "0.2" },
    });
    expect(parse(fixture(), "75199999").days).toEqual([]);
  });
  it.each([
    ["0", "PROTECTED", "0"],
    ["1", "VALIDATED", "0"],
    ["2", "SUSPECT", null],
    ["9", "FILTERED_ONLY", null],
    ["", "UNQUALIFIED", null],
    ["8", "UNQUALIFIED", null],
  ])(
    "keeps code %s distinct and accepts only qualified zero",
    (code, quality, analysisValue) => {
      expect(qualifyWeatherMeasurement("0", code)).toEqual({
        sourceValue: "0",
        qualityCode: code || null,
        quality,
        analysisValue,
      });
      expect(qualifyWeatherMeasurement("", code)).toMatchObject({
        sourceValue: null,
        quality: "MISSING",
        analysisValue: null,
      });
    },
  );
  it("supports quoted names, escaped quotes, CRLF/BOM and source ordering", () => {
    const a = row
      .replace("LARIBOISIERE", '"PARIS; ""CENTRE"""')
      .replace("20261001", "20261002");
    const result = parse(`\uFEFF${header}\r\n${a}\r\n${row}\r\n`);
    expect(result.days.map((d) => [d.producerDate, d.sourceRow])).toEqual([
      ["2026-10-01", 3],
      ["2026-10-02", 2],
    ]);
    expect(result.days[1]!.station.name).toBe('PARIS; "CENTRE"');
  });
  it.each([
    csv().replace("20261001", "20260230"),
    csv().replace("20261001", "20241001"),
    csv().replace("20261001", "20261201"),
    `${header}\n${row}\n${row}\n`,
    csv().replace("TN;QTN", "TN;TN"),
    csv().replace("TN;QTN;", ""),
    csv().replace("4.9;1", "NaN;1"),
    csv().replace("4.9;1", "10.0;1"),
    csv().replace(";0;1", ";-0.1;1"),
    csv().replace("48.882833", "148.882833"),
    csv().replace("LARIBOISIERE", '"unclosed'),
    csv().replace("LARIBOISIERE", 'bad"quote'),
    `${header}\n\n${row}\n`,
    csv().replace("LARIBOISIERE", "x".repeat(16_384)),
    csv().replace(";0;1", ";0"),
  ])(
    "refuses invalid input without returning a partial series (%#)",
    (input) => {
      expect(() => parse(input)).toThrow();
    },
  );
  it("retains suspect extrema without treating them as approved analytical temperatures", () => {
    const r = parse(csv().replace("4.9;1", "10.0;2"));
    expect(r.days[0]!.measurements.TN).toMatchObject({
      sourceValue: "10.0",
      quality: "SUSPECT",
      analysisValue: null,
    });
  });
  it("does not invent UTC measurement windows for overseas FU", () => {
    const r = parseObservedWeatherSource(
      gzipSync(csv().replace("75110001", "97101001")),
      "97101001",
      { ...provenance, sourceUrl: url("971") },
    );
    expect(r.days[0]!.rainfallWindow).toBeNull();
  });
  it("bounds decompression and rejects corrupt, empty, oversized and invalid-UTF8 files", () => {
    for (const b of [
      new Uint8Array(),
      new Uint8Array([1, 2, 3]),
      new Uint8Array(4_000_001),
      gzipSync(Buffer.alloc(32_000_001)),
      gzipSync(new Uint8Array([0xff])),
    ]) {
      expect(() =>
        parseObservedWeatherSource(b, "75110001", provenance),
      ).toThrow();
    }
  });
  it("checks source identity, station and retrieval date before parsing", () => {
    for (const sourceUrl of [
      url("75").replace("https:", "http:"),
      url("75").replace("meteofrance.s3.sbg.io.cloud.ovh.net", "example.org"),
      url("75") + "?x=1",
      url("75") + "#fragment",
      url("75").replace("2025-2026", "2026-2025"),
    ])
      expect(() =>
        parseObservedWeatherSource(gzipSync(csv()), "75110001", {
          ...provenance,
          sourceUrl,
        }),
      ).toThrow();
    expect(() => parse(csv(), "7511000")).toThrow();
    for (const retrievedAt of ["yesterday", "2026-02-30T00:00:00Z"])
      expect(() =>
        parseObservedWeatherSource(gzipSync(csv()), "75110001", {
          ...provenance,
          retrievedAt,
        }),
      ).toThrow();
  });
});
