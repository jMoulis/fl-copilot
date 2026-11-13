import { economicContextFixture } from "../../../../scripts/test-economic-fixtures";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import {
  WeeklyContextRepository,
  contextIsStale,
} from "./weekly-context-repository";
import { runLocalMigrations } from "../db/migrations";
function adapter(db: DatabaseSync) {
  return {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async getFirstAsync<T>(sql: string, ...p: (string | number | null)[]) {
      return (db.prepare(sql).get(...p) as T) ?? null;
    },
    async getAllAsync<T>(sql: string, ...p: (string | number | null)[]) {
      return db.prepare(sql).all(...p) as T[];
    },
    async runAsync(sql: string, ...p: (string | number | null)[]) {
      return db.prepare(sql).run(...p);
    },
  };
}
it("retains independent last-known providers offline after restart, isolates changed settings and rejects other stores", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flc_context_")),
    file = join(dir, "local.db");
  let db = new DatabaseSync(file);
  try {
    await runLocalMigrations(adapter(db));
    let repo = new WeeklyContextRepository(adapter(db));
    const settings = storeContextFixture(),
      original = weeklyContextFixture(settings);
    await repo.save(original, settings);
    db.close();
    db = new DatabaseSync(file);
    repo = new WeeklyContextRepository(adapter(db));
    expect(await repo.get(settings, original.weekStart)).toEqual(original);
    expect(
      contextIsStale(original.weather, new Date("2026-10-09T10:00:00Z")),
    ).toBe(true);
    const next = structuredClone(original);
    next.retrievedAt = "2026-10-09T10:00:00.000Z";
    next.weather = {
      ...next.weather,
      status: "UNAVAILABLE",
      retrievedAt: null,
      validUntil: null,
      issuedAt: null,
      days: [],
      issue: "PROVIDER_UNAVAILABLE",
    };
    next.publicHolidays.days = [{ date: "2026-10-10", label: "Test fixture" }];
    const saved = await repo.save(next, settings);
    expect(saved.weather).toEqual({
      ...original.weather,
      status: "STALE",
      issue: "PROVIDER_UNAVAILABLE",
    });
    expect(saved.publicHolidays.days).toHaveLength(1);
    expect(await repo.save(original, settings)).toEqual(saved);
    expect(
      await repo.get({ ...settings, version: 2 }, original.weekStart),
    ).toBeNull();
    await expect(repo.save(original, storeContextFixture())).rejects.toThrow(
      "CONTEXT_SETTINGS_CHANGED",
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual({
      n: 0,
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("preserves monthly context through offline restart and an older response that omits the optional extension", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    await runLocalMigrations(adapter(db));
    const settings = storeContextFixture(),
      repo = new WeeklyContextRepository(adapter(db)),
      c = weeklyContextFixture(settings);
    c.economy = economicContextFixture();
    await repo.save(c, settings);
    const olderResponse = structuredClone(c);
    delete olderResponse.economy;
    olderResponse.retrievedAt = "2026-11-14T08:00:00.000Z";
    expect((await repo.save(olderResponse, settings)).economy).toEqual(
      c.economy,
    );
    const failed = structuredClone(olderResponse);
    failed.retrievedAt = "2026-11-15T08:00:00.000Z";
    failed.economy = {
      ...c.economy,
      status: "UNAVAILABLE",
      series: [],
      retrievedAt: null,
      validUntil: null,
      issue: "PROVIDER_UNAVAILABLE",
    };
    const saved = await repo.save(failed, settings);
    expect(saved.economy).toEqual({
      ...c.economy,
      status: "STALE",
      issue: "PROVIDER_UNAVAILABLE",
    });
    expect(
      (await new WeeklyContextRepository(adapter(db)).get(
        settings,
        c.weekStart,
      ))!.economy,
    ).toEqual(saved.economy);
  } finally {
    db.close();
  }
});
