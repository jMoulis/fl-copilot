import { randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  addContextDays,
  storeContextFingerprint,
  weeklyContextSchema,
} from "@fl-copilot/domain";
import type { DatabaseService } from "../src/database/types";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import { createWeekContextService } from "../src/context/week-context";
import {
  collectDailyJournal,
  readDailyJournalWeek,
} from "../src/context/daily-journal";
import { weeklyContextFixture } from "../../../scripts/test-weekly-context-fixtures";
import { economicContextFixture } from "../../../scripts/test-economic-fixtures";
import { journalContextFixture } from "../../../scripts/test-journal-context-fixtures";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import { readCopilotWeek } from "../src/copilot/week-context-tool";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("durable daily shop context", () => {
  let database: DatabaseService;
  beforeAll(async () => {
    database = createMongoDatabase(
      parseEnvironment({
        NODE_ENV: "test",
        MONGODB_URI: uri,
        MONGODB_DATABASE: `flc_daily_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      }),
    );
    await database.getDb();
  });
  beforeEach(async () => {
    const db = await database.getDb();
    await db.collection("contextProviderCache").deleteMany({});
    await db.collection("storeContextSettings").deleteMany({});
  });
  afterAll(async () => {
    try {
      await (await database.getDb()).dropDatabase();
    } finally {
      await database.close();
    }
  });
  async function setup() {
    const settings = storeContextFixture();
    const db = await database.getDb();
    await db.collection("storeContextSettings").insertOne(settings);
    let outage = false;
    const read = vi.fn(async (storeId: string, weekStart: string) => {
      const c = weeklyContextFixture(settings);
      c.storeId = storeId;
      c.weekStart = weekStart;
      c.weekEnd = addContextDays(weekStart, 6);
      c.weather.days = c.weather.days.filter(
        (d) => d.validDate >= weekStart && d.validDate <= c.weekEnd,
      );
      c.economy = economicContextFixture();
      c.journal = journalContextFixture();
      if (outage) {
        c.weather.status = "UNAVAILABLE";
        c.weather.days = [];
        c.economy.status = "UNAVAILABLE";
        c.economy.series = [];
      }
      return weeklyContextSchema.parse(c);
    });
    return {
      settings,
      db,
      read,
      fail: () => {
        outage = true;
      },
    };
  }
  it("consolidates the day, retains source periods and survives restart with zero HTTP requests during AI turns", async () => {
    const { settings, db, read, fail } = await setup();
    const at = new Date("2026-10-09T08:00:00Z");
    expect(
      await collectDailyJournal(database, { read }, settings.storeId, at),
    ).toMatchObject({ status: "COLLECTED", date: "2026-10-09" });
    expect(read).toHaveBeenCalledTimes(3);
    expect(
      await collectDailyJournal(database, { read }, settings.storeId, at),
    ).toMatchObject({ status: "ALREADY_COLLECTED" });
    expect(read).toHaveBeenCalledTimes(3);
    fail();
    await collectDailyJournal(
      database,
      { read },
      settings.storeId,
      new Date("2026-10-09T12:00:00Z"),
    );
    const row = await db
      .collection("contextProviderCache")
      .findOne({ snapshotOf: /^journal-daily:/ });
    expect(row!.entry.firstCollectedAt).toBe(at.toISOString());
    expect(row!.entry.lastCollectedAt).toBe("2026-10-09T12:00:00.000Z");
    expect(
      await db
        .collection("contextProviderCache")
        .countDocuments({ snapshotOf: /^journal-daily:/ }),
    ).toBe(1);
    const network = vi.fn(() => {
      throw Error("PROVIDER_MUST_NOT_BE_CALLED");
    });
    const restarted = createWeekContextService(database, network, () => at, {
      preferStored: true,
    });
    const fromUi = await restarted.read(settings.storeId, "2026-10-05");
    expect(fromUi.weather.status).toBe("STALE");
    expect(fromUi.weather.days[0]!.validDate).toBe("2026-10-10");
    expect(fromUi).not.toHaveProperty("journal");
    const model = await readCopilotWeek(
      restarted,
      settings.storeId,
      { weekStart: "2026-10-05" },
      at,
    );
    expect(
      model.evidence.some((e) =>
        String(e.value).includes("Consommation 2026-09"),
      ),
    ).toBe(true);
    expect(model.context?.weather.days[0]!.type).toBe("FORECAST");
    expect(network).not.toHaveBeenCalled();
    expect(await db.collection("commercialWeekPlans").countDocuments()).toBe(0);
  });
  it("never reads another store's archives or mismatched geography, and tolerates unrelated settings updates", async () => {
    const { settings, db, read } = await setup();
    await collectDailyJournal(
      database,
      { read },
      settings.storeId,
      new Date("2026-10-09T08:00:00Z"),
    );
    const second = storeContextFixture();
    await db.collection("storeContextSettings").insertOne(second);
    expect(await readDailyJournalWeek(db, second, "2026-10-05")).toBeNull();
    expect(
      await readDailyJournalWeek(
        db,
        { ...settings, postalCode: "75001" },
        "2026-10-05",
      ),
    ).toBeNull();
    const updated = {
      ...settings,
      version: 2,
      updatedAt: "2026-10-09T10:00:00.000Z",
    };
    expect(
      (await readDailyJournalWeek(db, updated, "2026-10-05"))
        ?.settingsFingerprint,
    ).toBe(storeContextFingerprint(updated));
    const network = vi.fn(() => {
      throw Error("NO_LIVE_FALLBACK");
    });
    const service = createWeekContextService(database, network);
    const empty = await service.readStored!(second.storeId, "2026-10-05");
    expect(empty.weather.status).toBe("UNAVAILABLE");
    expect(empty.weather.days).toEqual([]);
    expect(network).not.toHaveBeenCalled();
    const later = createWeekContextService(
      database,
      network,
      () => new Date("2026-10-10T12:00:00Z"),
    );
    expect(
      (await later.readStored!(settings.storeId, "2026-10-05")).weather.status,
    ).toBe("STALE");
    expect(network).not.toHaveBeenCalled();
  });
  it("uses the Paris capture day and creates no fabricated entry for past observation days", async () => {
    const { settings, db, read } = await setup();
    await collectDailyJournal(
      database,
      { read },
      settings.storeId,
      new Date("2026-10-09T22:30:00Z"),
    );
    const rows = await db
      .collection("contextProviderCache")
      .find({ snapshotOf: /^journal-daily:/ })
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entry.date).toBe("2026-10-10");
    expect(
      rows[0]!.entry.contexts.map((c: { weekStart: string }) => c.weekStart),
    ).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
  });
  it("refuses to publish a mixed-location collection if settings change between providers", async () => {
    const { settings, db, read } = await setup();
    const changing = async (storeId: string, start: string) => {
      await db
        .collection("storeContextSettings")
        .updateOne({ storeId }, { $set: { postalCode: "75001" } });
      return read(storeId, start);
    };
    await expect(
      collectDailyJournal(
        database,
        { read: changing },
        settings.storeId,
        new Date("2026-10-09T08:00:00Z"),
      ),
    ).rejects.toThrow("JOURNAL_SETTINGS_CHANGED");
    expect(
      await db
        .collection("contextProviderCache")
        .countDocuments({ snapshotOf: /^journal-daily:/ }),
    ).toBe(0);
  });
  it("serializes concurrent first captures through the unique URL and exposes retry rather than false success", async () => {
    const { settings, db, read } = await setup();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        collectDailyJournal(
          database,
          { read },
          settings.storeId,
          new Date("2026-10-09T08:00:00Z"),
        ),
      ),
    );
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(
      await db
        .collection("contextProviderCache")
        .countDocuments({ snapshotOf: /^journal-daily:/ }),
    ).toBe(1);
    const retry = await collectDailyJournal(
      database,
      { read },
      settings.storeId,
      new Date("2026-10-09T08:00:00Z"),
    );
    expect(retry.status).toBe("ALREADY_COLLECTED");
  });
});
