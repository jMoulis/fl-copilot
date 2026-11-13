import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { parseInseeMonthly, readEconomicContext } from "./economy";
import { ContextProviderCache } from "./provider-cache";
import {
  economicContextSchema,
  economicDataSchema,
  weeklyContextSchema,
} from "@fl-copilot/domain";
import { economicContextFixture } from "../../../../scripts/test-economic-fixtures";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
const xml = readFileSync(
  new URL(
    "../../../../scripts/fixtures/insee-monthly-2026-11-13.xml",
    import.meta.url,
  ),
  "utf8",
);
const parse = (s = xml) => parseInseeMonthly(s, "2025-08", "2026-11");
it("qualifies the actual INSEE response with different latest months and its revision flag", () => {
  const d = parse();
  expect(d.series[0]!.points.at(-1)).toMatchObject({
    period: "2026-09",
    value: "101.86",
  });
  expect(d.series[1]!.points.at(-1)).toMatchObject({
    period: "2026-10",
    value: "80",
  });
  expect(d.series[1]!.points.find((p) => p.period === "2026-09")!.revised).toBe(
    true,
  );
  expect(d.series.every((s) => s.points.length <= 18)).toBe(true);
});
it("rejects malformed XML, DTD/entities, altered definitions, duplicate months/series and invalid numbers", () => {
  for (const s of [
    xml.slice(0, -30),
    `<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]>${xml}`,
    xml.replace('FREQ="M"', 'FREQ="D"'),
    xml.replace("Base 2025", "Base 2030"),
    xml.replace('UNIT_MULT="0"', 'UNIT_MULT="2"'),
    xml.replace('OBS_VALUE="101.86"', 'OBS_VALUE="-1"'),
    xml.replace('TIME_PERIOD="2026-08"', 'TIME_PERIOD="2026-09"'),
    xml.replace('IDBANK="001587668"', 'IDBANK="011813720"'),
  ])
    expect(() => parse(s)).toThrow();
});
it("keeps source missing/confidential values null and a valid zero for confidence", () => {
  expect(
    parse(
      xml.replace('OBS_VALUE="101.86"', 'OBS_VALUE="NaN"'),
    ).series[0]!.points.at(-1)!.value,
  ).toBeNull();
  const confidential = xml.replace(
    'OBS_VALUE="101.86" OBS_STATUS="A"',
    'OBS_VALUE="101.86" OBS_STATUS="C"',
  );
  expect(parse(confidential).series[0]!.points.at(-1)!.value).toBeNull();
  expect(
    parse(xml.replace('OBS_VALUE="80"', 'OBS_VALUE="0"')).series[1]!.points.at(
      -1,
    )!.value,
  ).toBe("0");
});
it("extends contexts only optionally and rejects invented duplicate economic months", () => {
  expect(weeklyContextSchema.parse(weeklyContextFixture())).not.toHaveProperty(
    "economy",
  );
  expect(
    weeklyContextSchema.parse({
      ...weeklyContextFixture(),
      economy: economicContextFixture(),
    }),
  ).toHaveProperty("economy");
  const c = economicContextFixture();
  c.series[0]!.points.push(c.series[0]!.points[0]!);
  expect(economicContextSchema.safeParse(c).success).toBe(false);
});
it("uses the shared cache once per month range, does not request future source months, and preserves stale data", async () => {
  const read = vi
    .spyOn(ContextProviderCache.prototype, "read")
    .mockResolvedValue({
      data: parse(),
      retrievedAt: "2026-11-13T08:00:00.000Z",
      validUntil: "2026-11-14T08:00:00.000Z",
      failed: false,
    });
  try {
    const cache = new ContextProviderCache({} as never);
    const result = await readEconomicContext(
      cache,
      "2026-11-09",
      "2026-11-15",
      new Date("2026-11-13T08:00:00Z"),
    );
    expect(read).toHaveBeenCalledWith(
      expect.stringContaining("startPeriod=2025-08&endPeriod=2026-11"),
      economicDataSchema,
      86400000,
      expect.objectContaining({ accept: expect.stringContaining("xml") }),
    );
    expect(result).toMatchObject({
      status: "AVAILABLE",
      vintage: "CURRENT_REVISED",
      historicalPublicationDatesKnown: false,
    });
    read.mockResolvedValue({
      data: parse(),
      retrievedAt: result.retrievedAt,
      validUntil: result.validUntil,
      failed: true,
    });
    expect(
      (
        await readEconomicContext(
          cache,
          "2026-11-09",
          "2026-11-15",
          new Date("2026-11-14T08:00:00Z"),
        )
      ).status,
    ).toBe("STALE");
    read.mockClear();
    expect(
      (
        await readEconomicContext(
          cache,
          "2030-01-07",
          "2030-01-13",
          new Date("2026-11-13T08:00:00Z"),
        )
      ).status,
    ).toBe("UNAVAILABLE");
    expect(read).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
});
