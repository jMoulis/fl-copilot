import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  observedWeatherContextSchema,
  weeklyContextSchema,
} from "@fl-copilot/domain";
import { readObservedWeather } from "./observed-weather";
import { nearestObservedWeatherStation } from "./observed-weather-source";
import type { ContextProviderCache } from "./provider-cache";
import { observedWeatherContextFixture } from "../../../../scripts/test-observed-weather-fixtures";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
const file = (dep: string) =>
  readFileSync(
    new URL(
      `../../../../scripts/fixtures/meteofrance-${dep}-sample.csv`,
      import.meta.url,
    ),
    "utf8",
  );
const url = (dep: string) =>
  `https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_${dep}_latest-2025-2026_RR-T-Vent.csv.gz`;
const prior = url("92").replace("latest-2025-2026", "previous-1950-2024");
const point = { latitude: 48.9181, longitude: 2.2935 },
  now = new Date("2026-11-13T08:00:00Z");
function fakeCache(
  at = now,
  failed = false,
  resources = [url("92"), url("75"), prior],
  overrides: Record<string, string> = {},
) {
  const read = vi.fn(
    async (
      source: string,
      _schema: unknown,
      _ttl: number,
      representation: { decode(r: Response): Promise<unknown> },
    ) => {
      const csv =
        overrides[source] ??
        (source === prior
          ? file("92").replaceAll("2025", "2023").replaceAll("2026", "2024")
          : file(source.includes("Q_75") ? "75" : "92"));
      const response = source.includes("data.gouv.fr/api")
        ? Response.json({ resources: resources.map((url) => ({ url })) })
        : new Response(gzipSync(csv));
      return {
        data: await representation.decode(response),
        failed,
        retrievedAt: at.toISOString(),
        validUntil: new Date(at.getTime() + 86400000).toISOString(),
      };
    },
  );
  return { cache: { read } as unknown as ContextProviderCache, read };
}
it("selects geographically within the department, reuses one archive, and returns only the requested real station days", async () => {
  const { cache, read } = fakeCache();
  const c = await readObservedWeather(
    cache,
    point,
    "92",
    "2026-09-28",
    "2026-10-04",
    now,
  );
  expect(c.status).toBe("AVAILABLE");
  expect(c.reference?.station.id).toBe("92073001");
  expect(c.days.map((d) => d.producerDate)).toEqual([
    "2026-10-01",
    "2026-10-02",
  ]);
  expect(c.days[0]!.measurements).toMatchObject({
    TN: { analysisValue: "16.5" },
    TX: { analysisValue: "23.0" },
    RR: { analysisValue: "0.0" },
  });
  expect(c.days[0]!.sourceRow).toBe(3);
  expect(c.days[0]!.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls.every(([u]) => !u.includes("Q_75"))).toBe(true);
  expect(JSON.stringify(c)).not.toContain("base64");
});
it("keeps the same recent reference across current, N-1 and older archive reads without station substitution", async () => {
  const { cache } = fakeCache();
  const refs = [];
  for (const [start, end] of [
    ["2026-09-28", "2026-10-04"],
    ["2025-09-29", "2025-10-05"],
    ["2024-09-30", "2024-10-06"],
  ]) {
    const c = await readObservedWeather(cache, point, "92", start!, end!, now);
    refs.push(c.reference?.station.id);
    expect(c.days.length).toBeGreaterThan(0);
    expect(
      c.days.every((d) => d.producerDate >= start! && d.producerDate <= end!),
    ).toBe(true);
  }
  expect(refs).toEqual(["92073001", "92073001", "92073001"]);
});
it("does not call providers for future-only weeks or unqualified overseas measurement windows", async () => {
  const { cache, read } = fakeCache();
  expect(
    (
      await readObservedWeather(
        cache,
        point,
        "92",
        "2026-11-16",
        "2026-11-22",
        now,
      )
    ).issue,
  ).toBe("PERIOD_NOT_OBSERVED");
  expect(
    (
      await readObservedWeather(
        cache,
        point,
        "97",
        "2026-09-28",
        "2026-10-04",
        now,
      )
    ).issue,
  ).toBe("UNSUPPORTED_REGION");
  expect(read).not.toHaveBeenCalled();
});
it("retains actual periods and stale source state, and omits an unfinished 06UTC rain window", async () => {
  const { cache } = fakeCache(now, true);
  expect(
    (
      await readObservedWeather(
        cache,
        point,
        "92",
        "2026-09-28",
        "2026-10-04",
        now,
      )
    ).status,
  ).toBe("STALE");
  const early = new Date("2026-10-02T05:00:00Z"),
    f = fakeCache(early);
  expect(
    (
      await readObservedWeather(
        f.cache,
        point,
        "92",
        "2026-09-28",
        "2026-10-04",
        early,
      )
    ).days,
  ).toEqual([]);
});
it("refuses arbitrary catalog hosts, missing archive ranges and absent recent sources without substituting another department", async () => {
  for (const resources of [
    [],
    [url("75")],
    [url("92").replace("meteofrance.s3.sbg.io.cloud.ovh.net", "example.org")],
  ]) {
    const { cache, read } = fakeCache(now, false, resources);
    expect(
      (
        await readObservedWeather(
          cache,
          point,
          "92",
          "2026-09-28",
          "2026-10-04",
          now,
        )
      ).issue,
    ).toBe("NO_ARCHIVE");
    expect(read).toHaveBeenCalledTimes(1);
  }
  const { cache } = fakeCache(now, false, [url("92")]);
  const c = await readObservedWeather(
    cache,
    point,
    "92",
    "2024-09-30",
    "2024-10-06",
    now,
  );
  expect(c.days).toEqual([]);
  expect(c.issue).toBe("NO_ARCHIVE");
});
it("uses latest published station positions and a deterministic distance tie, independently of sales", () => {
  const csv = file("92");
  const h = csv.split("\n")[0]!,
    row = csv.split("\n")[1]!;
  const data = gzipSync(
    `${h}\n${row.replace("92073001", "92000001")}\n${row}\n`,
  );
  expect(nearestObservedWeatherStation(data, point)?.station.id).toBe(
    "92000001",
  );
  expect(() =>
    nearestObservedWeatherStation(data, { latitude: NaN, longitude: 0 }),
  ).toThrow();
});
it("negotiates an optional contract, rejecting altered dates, unqualified zero, duplicates and foreign station identities", () => {
  const c = observedWeatherContextFixture(),
    context = weeklyContextFixture();
  expect(weeklyContextSchema.parse(context)).not.toHaveProperty(
    "observedWeather",
  );
  expect(
    weeklyContextSchema.parse({ ...context, observedWeather: c })
      .observedWeather,
  ).toEqual(c);
  for (const mutate of [
    (v: typeof c) => {
      v.days[0]!.rainfallWindow.to = "2026-10-09T05:00:00.000Z";
    },
    (v: typeof c) => {
      v.days[0]!.measurements.RR.qualityCode = "9";
    },
    (v: typeof c) => {
      v.days.push(v.days[0]!);
    },
    (v: typeof c) => {
      v.reference!.station.id = "75110001";
    },
  ]) {
    const next = structuredClone(c);
    mutate(next);
    expect(() => observedWeatherContextSchema.parse(next)).toThrow();
  }
  expect(() =>
    weeklyContextSchema.parse({
      ...context,
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      observedWeather: c,
    }),
  ).toThrow();
});

it("joins a year-crossing week from distinct archives without changing reference or downloading the recent archive twice", async () => {
  const old = file("92")
    .replaceAll("20251001", "20241230")
    .replaceAll("20261001", "20241231")
    .replaceAll("20261002", "20241229");
  const recent = file("92")
    .replaceAll("20251001", "20250101")
    .replaceAll("20261001", "20250102");
  const { cache, read } = fakeCache(now, false, [url("92"), prior], {
    [url("92")]: recent,
    [prior]: old,
  });
  const c = await readObservedWeather(
    cache,
    point,
    "92",
    "2024-12-30",
    "2025-01-05",
    now,
  );
  expect(c.days.map((d) => d.producerDate)).toEqual([
    "2024-12-30",
    "2024-12-31",
    "2025-01-01",
    "2025-01-02",
  ]);
  expect(new Set(c.days.map((d) => d.station.id))).toEqual(
    new Set(["92073001"]),
  );
  expect(new Set(c.days.map((d) => d.sourceUrl)).size).toBe(2);
  expect(read).toHaveBeenCalledTimes(3);
});
