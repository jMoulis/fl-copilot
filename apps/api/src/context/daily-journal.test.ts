import { expect, it, vi } from "vitest";
import { Inngest } from "inngest";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { observedWeatherContextFixture } from "../../../../scripts/test-observed-weather-fixtures";
import { economicContextFixture } from "../../../../scripts/test-economic-fixtures";
import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import {
  mergeDailyWeek,
  contextMonday,
  dailyJournalScope,
  projectContext,
} from "./daily-journal";
import {
  createJournalWorkflows,
  journalCollectionSchedule,
} from "./journal-workflows";
import { readCopilotWeek } from "../copilot/week-context-tool";
it("retains last known values and actual source times on independent outages", () => {
  const old = weeklyContextFixture();
  old.economy = economicContextFixture();
  old.observedWeather = observedWeatherContextFixture();
  old.journal = journalContextFixture();
  const next = structuredClone(old);
  next.weather = {
    ...next.weather,
    status: "UNAVAILABLE",
    days: [],
    retrievedAt: null,
    validUntil: null,
  };
  next.economy = { ...next.economy!, status: "UNAVAILABLE", series: [] };
  next.observedWeather = {
    ...next.observedWeather!,
    status: "UNAVAILABLE",
    days: [],
  };
  next.journal!.sources[0] = {
    ...next.journal!.sources[0]!,
    status: "UNAVAILABLE",
    payload: null,
    history: [],
  };
  const result = mergeDailyWeek(old, next);
  expect(result.weather).toEqual({ ...old.weather, status: "STALE" });
  expect(result.economy).toEqual({ ...old.economy, status: "STALE" });
  expect(result.observedWeather).toEqual({
    ...old.observedWeather,
    status: "STALE",
  });
  expect(result.journal!.sources[0]!.payload).toEqual(
    old.journal.sources[0]!.payload,
  );
  expect(result.journal!.sources[1]!.status).toBe("AVAILABLE");
  expect(projectContext(result, false, false, false, false)).not.toHaveProperty(
    "journal",
  );
  expect(old.weather.status).toBe("AVAILABLE");
});
it("takes newly revised observed measurements instead of silently keeping the old day", () => {
  const old = weeklyContextFixture();
  old.observedWeather = observedWeatherContextFixture();
  const next = structuredClone(old);
  next.observedWeather!.days[0]!.measurements.TX = {
    sourceValue: "19.2",
    analysisValue: "19.2",
    quality: "VALIDATED",
    qualityCode: "1",
  };
  expect(
    mergeDailyWeek(old, next).observedWeather!.days[0]!.measurements.TX
      .analysisValue,
  ).toBe("19.2");
});
it("binds geographic archive scope without invalidating history for unrelated store versions", () => {
  const store = storeContextFixture();
  expect(
    dailyJournalScope({
      ...store,
      version: 42,
      updatedAt: "2026-11-13T12:00:00.000Z",
    }),
  ).toBe(dailyJournalScope(store));
  expect(dailyJournalScope({ ...store, postalCode: "75001" })).not.toBe(
    dailyJournalScope(store),
  );
  expect(contextMonday("2026-11-01")).toBe("2026-10-26");
  expect(contextMonday("2026-11-02")).toBe("2026-11-02");
});
it("registers a local-time schedule and bounded signed workers without invoking providers on registration", () => {
  const db = {
    getDb: vi.fn(),
    checkHealth: async () => "connected" as const,
    close: async () => {},
  };
  const read = vi.fn();
  const functions = createJournalWorkflows(new Inngest({ id: "test" }), db, {
    read,
  });
  expect(functions.map((f) => f.id())).toEqual([
    "journal-collect-schedule-v1",
    "journal-collect-store-day-v1",
  ]);
  expect(journalCollectionSchedule).toBe("TZ=Europe/Paris 15 7,13,20 * * *");
  expect(read).not.toHaveBeenCalled();
  expect(db.getDb).not.toHaveBeenCalled();
});
it("the Copilot reads the stored journal without triggering live refresh even on repeated turns", async () => {
  const source = weeklyContextFixture();
  const read = vi.fn(() => {
    throw Error("NETWORK_FORBIDDEN_IN_TURN");
  });
  const readStored = vi.fn(async () => source);
  for (let i = 0; i < 2; i++) {
    const result = await readCopilotWeek({ read, readStored }, source.storeId, {
      weekStart: source.weekStart,
    });
    expect(result.context?.weather.days).toHaveLength(1);
  }
  expect(readStored).toHaveBeenCalledTimes(2);
  expect(read).not.toHaveBeenCalled();
});
