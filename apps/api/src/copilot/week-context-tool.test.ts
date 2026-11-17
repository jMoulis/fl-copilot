import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import { observedWeatherContextFixture } from "../../../../scripts/test-observed-weather-fixtures";
import {
  economicContextFixture,
  economicProduceContextFixture,
} from "../../../../scripts/test-economic-fixtures";
import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { AuthError } from "../auth/service";
import { readCopilotWeek } from "./week-context-tool";
import { renderAnswerContent } from "./answer-text";

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
  expect(missing.evidence[0]!.detail).toContain("commune");
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
  expect(result.evidence).toHaveLength(10);
  expect(result.context).not.toHaveProperty("economy");
  const economic = result.evidence.filter((e) => e.id.includes("/economy/"));
  expect(economic.map((e) => e.value)).toEqual([
    "2026-09",
    "102",
    "2.00",
    "2026-10",
    "80",
    "-5.00",
  ]);
  const fact = result.evidence.at(-1)!;
  expect(economic[0]!.detail).toContain("inconnues");
  expect(economic[0]!.sourceId).toBe(
    "https://www.insee.fr/fr/statistiques/serie/011813720",
  );
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
  expect(result.evidence[3]!.detail).toContain("Consommation 2026-09");
  expect(result.evidence[3]!.detail).toContain("6.59 kg/ménage");
  expect(result.evidence[3]!.detail).toContain("Salon local");
  expect(result.evidence[3]!.detail).toContain("Transport non configuré");
  expect(String(result.evidence[3]!.detail).length).toBeLessThan(7000);
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
  expect(String(result.evidence[3]!.detail).length).toBeLessThan(10000);
  expect(result.evidence[3]!.detail).toContain("Extrait partiel");
  expect(result.context).not.toHaveProperty("journal");
});

it("reuses archived produce indices as compact facts with their scope and original source, without a new provider call", async () => {
  const context = weeklyContextFixture();
  context.weekStart = "2026-11-09";
  context.weekEnd = "2026-11-15";
  context.economy = economicProduceContextFixture();
  context.weather.days = [];
  const readStored = vi.fn(async () => context),
    read = vi.fn();
  const result = await readCopilotWeek({ readStored, read }, context.storeId, {
    weekStart: context.weekStart,
  });
  expect(read).not.toHaveBeenCalled();
  expect(result.evidence).toHaveLength(16);
  const economic = result.evidence.filter((e) => e.id.includes("/economy/"));
  expect(economic.map((e) => e.value)).toContain("5.25");
  expect(economic.map((e) => e.value)).toContain("-10.00");
  const fruit = economic.find((e) => e.id.endsWith("011814957/index"))!;
  expect(fruit.detail).toContain(
    "ne correspondent pas strictement au rayon frais",
  );
  expect(fruit.sourceId).toBe(
    "https://www.insee.fr/fr/statistiques/serie/011814957",
  );
  expect(result.context).not.toHaveProperty("economy");
  expect(JSON.stringify(result)).not.toContain('"points":');
});

it("renders only the requested economic values in a table while keeping unrelated Journal context inside source details", async () => {
  const c = weeklyContextFixture();
  c.weekStart = "2026-11-09";
  c.weekEnd = "2026-11-15";
  c.economy = economicProduceContextFixture();
  c.weather.days = [];
  c.journal = journalContextFixture();
  const result = await readCopilotWeek(
    { readStored: async () => c, read: vi.fn() },
    c.storeId,
    { weekStart: c.weekStart },
  );
  const selected = result.evidence.filter((e) =>
    /economy\/(011814957|011815032)\//.test(e.id),
  );
  const content = renderAnswerContent(
    "| Indicateur | Mois | Indice | Évolution annuelle |\n|---|---|---:|---:|\n| Fruits | {{value:0}} | {{value:1}} | {{value:2}} % {{source:1}} |\n| Légumes | {{value:3}} | {{value:4}} | {{value:5}} % {{source:4}} |",
    selected.map((e) => ({ evidenceId: e.id })),
    result.evidence,
  );
  expect(content.text).toContain("105,25");
  expect(content.text).toContain("5,25 %");
  expect(content.text).toContain("-10,00 %");
  const visible = content.text.replace(
    /\[Source\]\(copilot-source:[^)]+\)/g,
    "Source",
  );
  expect(visible).not.toMatch(
    /Semaine du lundi|Salon local|Transport|rafraîchissement|fournisseur|inconnues/,
  );
  const sources = [...content.text.matchAll(/copilot-source:([^)]*)/g)].map(
    (m) => JSON.parse(decodeURIComponent(m[1]!)) as { value: string },
  );
  expect(sources).toHaveLength(2);
  expect(sources[0]!.value).toContain(
    "ne correspondent pas strictement au rayon frais",
  );
  expect(result.evidence.at(-1)!.detail).toContain("Salon local");
});

it("keeps missing economic values null instead of turning them into zero", async () => {
  const c = weeklyContextFixture();
  c.economy = economicContextFixture();
  c.economy.series[0]!.points = [];
  const result = await readCopilotWeek({ read: async () => c }, c.storeId, {
    weekStart: c.weekStart,
  });
  expect(
    result.evidence
      .filter((e) => e.id.includes("economy/011813720/"))
      .map((e) => e.value),
  ).toEqual([null, null, null]);
});
it("keeps four economic series and three national citations bounded, reading archives only", async () => {
  const c = weeklyContextFixture();
  c.economy = economicProduceContextFixture();
  c.journal = journalContextFixture();
  c.journal.national = [
    {
      ...structuredClone(c.journal.sources[0]!),
      kind: "NATIONAL_SOCIAL",
      history: [],
      payload: {
        consumption: null,
        items: Array.from({ length: 3 }, (_, i) => ({
          title: `Appel ${i}`,
          summary: "Mobilisation annoncée",
          sourceUrl: `https://www.cgt.fr/appel-${i}`,
          publishedAt: "2026-10-08T10:00:00.000Z",
          periodLabel: "Date à vérifier",
          startDate: null,
          endDate: null,
        })),
      },
    },
  ];
  const read = vi.fn();
  const readStored = vi.fn(async () => c);
  const result = await readCopilotWeek(
    { read, readStored },
    c.storeId,
    { weekStart: c.weekStart },
    new Date("2026-10-09T12:00:00Z"),
  );
  expect(read).not.toHaveBeenCalled();
  expect(result.evidence).toHaveLength(19);
  expect(
    result.evidence.filter((e) => e.sourceId.startsWith("https://www.cgt.fr/")),
  ).toHaveLength(3);
  expect(
    result.evidence
      .filter((e) => e.sourceId.startsWith("https://www.cgt.fr/"))
      .every((e) => e.detail?.includes("Période exacte inconnue")),
  ).toBe(true);
});
