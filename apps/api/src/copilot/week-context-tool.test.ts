import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import { observedWeatherContextFixture } from "../../../../scripts/test-observed-weather-fixtures";
import { economicContextFixture } from "../../../../scripts/test-economic-fixtures";
import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { AuthError } from "../auth/service";
import { readCopilotWeek } from "./week-context-tool";

it("projects scoped weekly providers, forecast coverage and public sources without the GPS fingerprint", async () => {
  const c = weeklyContextFixture();
  c.settingsFingerprint = JSON.stringify({
    latitude: 48.9181,
    longitude: 2.2935,
  });
  const read = vi.fn(async () => c),
    now = new Date("2026-10-09T08:30:00Z");
  const result = await readCopilotWeek(
    { read },
    c.storeId,
    { weekStart: c.weekStart },
    now,
  );
  expect(read).toHaveBeenCalledWith(
    c.storeId,
    c.weekStart,
    false,
    true,
    true,
    true,
  );
  expect(result.context?.weather.days[0]).toMatchObject({
    type: "FORECAST",
    precipitationMm: 0,
    precipitationHours: 24,
  });
  expect(result.context).not.toHaveProperty("settingsFingerprint");
  expect(JSON.stringify(result)).not.toContain("48.9181");
  expect(result.evidence[0]!.value).toContain("1 jours de prévision");
  expect(result.evidence[0]!.value).toContain("pas nuls");
  expect(result.evidence[1]!.value).toContain("Aucun jour férié");
  expect(result.evidence[2]!.label).toContain("zone C");
  expect(result.evidence[0]).toMatchObject({
    sourceType: "SOURCE_DOCUMENT",
    factKind: "DERIVED",
    sourceId: c.weather.sourceUrl,
  });
  const id = result.evidence[0]!.id;
  c.weather.days[0]!.temperatureMaxC = 19;
  expect(
    (
      await readCopilotWeek(
        { read },
        c.storeId,
        { weekStart: c.weekStart },
        now,
      )
    ).evidence[0]!.id,
  ).not.toBe(id);
});
it("keeps stale/unavailable and unconfigured calendars distinct from absence, without mutating the source", async () => {
  const c = weeklyContextFixture();
  c.publicHolidays.status = "UNAVAILABLE";
  c.schoolHolidays.status = "NOT_CONFIGURED";
  c.schoolHolidays.zone = null;
  c.schoolHolidays.issue = "ZONE_REQUIRED";
  c.weather.days[0]!.precipitationMm = null;
  c.weather.days[0]!.precipitationHours = 12;
  const result = await readCopilotWeek(
    { read: async () => c },
    c.storeId,
    { weekStart: c.weekStart },
    new Date("2026-10-09T09:00:00Z"),
  );
  expect(result.context?.weather.status).toBe("STALE");
  expect(c.weather.status).toBe("AVAILABLE");
  expect(result.context?.publicHolidays.status).toBe("UNAVAILABLE");
  expect(result.evidence[0]!.value).toContain("pluie inconnue");
  expect(result.evidence[1]!.value).not.toContain("Aucun jour férié dans");
  expect(result.evidence[2]!.label).toContain("zone à préciser");
  expect(result.evidence[2]!.value).not.toContain(
    "Aucune période de vacances dans",
  );
});
it("asks for unsynchronized settings while rejecting invalid dates, foreign stores/weeks and unexpected failures", async () => {
  const c = weeklyContextFixture(),
    read = vi.fn(async () => c);
  for (const weekStart of ["2026-10-06", "2026-02-30"])
    await expect(
      readCopilotWeek({ read }, c.storeId, { weekStart }),
    ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  await expect(
    readCopilotWeek({ read }, randomUUID(), { weekStart: c.weekStart }),
  ).rejects.toThrow("SCOPE");
  await expect(
    readCopilotWeek({ read }, c.storeId, { weekStart: "2026-10-12" }),
  ).rejects.toThrow("SCOPE");
  const missing = await readCopilotWeek(
    {
      read: async () => {
        throw new AuthError(409, "STORE_SETTINGS_NOT_SYNCED", "absents");
      },
    },
    c.storeId,
    { weekStart: c.weekStart },
  );
  expect(missing.context).toBeNull();
  expect(missing.evidence[0]!.value).toContain("commune");
  await expect(
    readCopilotWeek(
      {
        read: async () => {
          throw Error("internal");
        },
      },
      c.storeId,
      { weekStart: c.weekStart },
    ),
  ).rejects.toThrow("internal");
});

it("adds compact national monthly facts without widening the old context shape or serializing the full source series", async () => {
  const c = weeklyContextFixture();
  c.weekStart = "2026-11-09";
  c.weekEnd = "2026-11-15";
  c.weather.days = [];
  c.economy = economicContextFixture();
  const result = await readCopilotWeek(
    { read: async () => c },
    c.storeId,
    { weekStart: c.weekStart },
    new Date("2026-11-13T09:00:00Z"),
  );
  expect(result.evidence).toHaveLength(4);
  expect(result.context).not.toHaveProperty("economy");
  const fact = result.evidence.at(-1)!;
  expect(fact.value).toContain("2026-09, indice 102");
  expect(fact.value).toContain("2.00 %");
  expect(fact.value).toContain("2026-10, indice 80");
  expect(fact.value).toContain("-5.00 points");
  expect(fact.value).toContain("inconnues");
  expect(fact.sourceId).toContain("bdm.insee.fr");
  expect(JSON.stringify(result)).not.toContain('"points":');
  c.economy.series[0]!.points.at(-1)!.value = "103";
  expect(
    (
      await readCopilotWeek({ read: async () => c }, c.storeId, {
        weekStart: c.weekStart,
      })
    ).evidence.at(-1)!.id,
  ).not.toBe(fact.id);
});

it("keeps observed station days separate from forecasts in compact existing evidence and changes provenance on revision", async () => {
  const c = weeklyContextFixture();
  c.observedWeather = observedWeatherContextFixture();
  const result = await readCopilotWeek(
    { read: async () => c },
    c.storeId,
    { weekStart: c.weekStart },
    new Date("2026-10-09T08:30:00Z"),
  );
  expect(result.evidence).toHaveLength(4);
  expect(result.context).not.toHaveProperty("observedWeather");
  expect(result.evidence[0]!.value).toContain("Mesures observées");
  expect(result.evidence[0]!.value).toContain(
    "2026-10-08 : min 9.0 / max 18.0 °C ; pluie 0.0 mm",
  );
  expect(result.evidence[0]!.value).toContain("06h UTC");
  expect(result.evidence[0]!.value).toContain("Référence automatique");
  expect(JSON.stringify(result)).not.toContain("base64");
  c.observedWeather.days[0]!.sourceSha256 = "b".repeat(64);
  expect(
    (
      await readCopilotWeek(
        { read: async () => c },
        c.storeId,
        { weekStart: c.weekStart },
        new Date("2026-10-09T08:30:00Z"),
      )
    ).evidence[0]!.id,
  ).not.toBe(result.evidence[0]!.id);
});

it("keeps bounded journal summaries in existing evidence, never repeats revision payloads into model context", async () => {
  const c = weeklyContextFixture();
  c.journal = journalContextFixture();
  c.weekStart = "2026-11-09";
  c.weekEnd = "2026-11-15";
  c.weather.days = [];
  const result = await readCopilotWeek(
    { read: async () => c },
    c.storeId,
    { weekStart: c.weekStart },
    new Date("2026-11-14T12:00:00Z"),
  );
  expect(result.context).not.toHaveProperty("journal");
  expect(result.evidence).toHaveLength(4);
  expect(result.evidence[3]!.value).toContain("Consommation 2026-09");
  expect(result.evidence[3]!.value).toContain("6.59 kg/ménage");
  expect(result.evidence[3]!.value).toContain("Salon local");
  expect(result.evidence[3]!.value).toContain("Transport non configuré");
  expect(String(result.evidence[3]!.value).length).toBeLessThan(7000);
  expect(JSON.stringify(result)).not.toContain('"history"');
});

it("bounds transit context for many long messages without leaking coordinates or transport histories", async () => {
  const c = weeklyContextFixture();
  c.weekStart = "2026-11-09";
  c.weekEnd = "2026-11-15";
  c.weather.days = [];
  c.journal = journalContextFixture();
  c.journal.transport = {
    status: "AVAILABLE",
    issue: null,
    radiusMetres: 800,
    lines: Array.from({ length: 16 }, (_, i) => ({
      id: `IDFM:C${String(i).padStart(5, "0")}`,
      name: "Metro 13",
      stopName: "Arrêt proche",
      distanceMetres: 300,
      status: "AVAILABLE" as const,
      retrievedAt: "2026-11-13T10:00:00.000Z",
      validUntil: "2026-11-13T11:00:00.000Z",
      capturedAt: "2026-11-13T10:00:00.000Z",
      partial: true,
      disruptions: Array.from({ length: 8 }, (_, j) => ({
        id: String(j),
        message: "Message publié ".repeat(46).slice(0, 700),
        effect: null,
        applicationPeriods: [
          { begin: "20261114T220000", end: "20261115T020000" },
        ],
        schedule: "Horaires récurrents ".repeat(30).slice(0, 600),
        updatedAt: null,
      })),
    })),
  };
  const result = await readCopilotWeek(
    { read: async () => c },
    c.storeId,
    { weekStart: c.weekStart },
    new Date("2026-11-13T10:01:00Z"),
  );
  expect(result.evidence).toHaveLength(4);
  expect(String(result.evidence[3]!.value).length).toBeLessThan(10000);
  expect(result.evidence[3]!.value).toContain("Extrait partiel");
  expect(result.context).not.toHaveProperty("journal");
});
