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
  expect(read).toHaveBeenCalledWith(c.storeId, c.weekStart);
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
