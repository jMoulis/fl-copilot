import { storeTransportsFixture } from "../../../scripts/test-store-transports-fixtures";
import { randomUUID, createHash } from "node:crypto";
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
  it("preserves recorded weather when transports are first configured or their selection changes", async () => {
    const { settings, db, read } = await setup();
    const at = new Date("2026-10-09T08:00:00Z");
    await collectDailyJournal(database, { read }, settings.storeId, at);
    const withTransport = { ...settings, transports: storeTransportsFixture() };
    const first = await readDailyJournalWeek(
      db,
      withTransport,
      "2026-10-05",
      at,
    );
    expect(first?.weather.days[0]?.validDate).toBe("2026-10-10");
    expect(first?.journal?.transport).toMatchObject({
      status: "UNAVAILABLE",
      issue: "HISTORY_UNAVAILABLE",
      lines: [{ id: "IDFM:C01383", status: "UNAVAILABLE" }],
    });
    const disabled = {
      ...withTransport,
      transports: {
        ...withTransport.transports,
        lines: withTransport.transports.lines.map((l) => ({
          ...l,
          enabled: false,
        })),
      },
    };
    const second = await readDailyJournalWeek(db, disabled, "2026-10-05", at);
    expect(second?.weather.days[0]?.validDate).toBe("2026-10-10");
    expect(second?.journal?.transport).toMatchObject({
      status: "NOT_CONFIGURED",
      issue: "NO_SELECTED_LINES",
      lines: [],
    });
  });
  it("filters saved transit to the current selection, leaves new lines unknown and retains eligible legacy entries", async () => {
    const { settings, db, read } = await setup();
    const at = new Date("2026-10-09T08:00:00Z");
    const configured = { ...settings, transports: storeTransportsFixture() };
    await db
      .collection("storeContextSettings")
      .updateOne(
        { storeId: settings.storeId },
        { $set: { transports: configured.transports } },
      );
    const live = async (storeId: string, weekStart: string) => {
      const context = await read(storeId, weekStart);
      const line = configured.transports.lines[0]!;
      context.journal!.transport = {
        status: "AVAILABLE",
        issue: null,
        radiusMetres: 800,
        lines: [
          {
            id: line.id,
            name: "Metro 13",
            stopName: line.stopName,
            distanceMetres: line.distanceMetres,
            status: "AVAILABLE",
            retrievedAt: at.toISOString(),
            validUntil: "2026-10-09T09:00:00.000Z",
            capturedAt: at.toISOString(),
            disruptions: [],
            partial: false,
          },
        ],
      };
      return context;
    };
    await collectDailyJournal(database, { read: live }, settings.storeId, at);
    // Qualify the already-published key format, not just newly written entries.
    const oldScope = createHash("sha256")
      .update(
        JSON.stringify([
          settings.storeId,
          settings.city,
          settings.postalCode,
          settings.schoolZone,
          settings.locationMode,
          settings.position,
          configured.transports,
        ]),
      )
      .digest("hex");
    const row = await db
      .collection("contextProviderCache")
      .findOne({ snapshotOf: /^journal-daily:/ });
    const legacySource = `journal-daily:${settings.storeId}:${oldScope}`;
    await db.collection("contextProviderCache").updateOne(
      { _id: row!._id },
      {
        $set: {
          url: `${legacySource}:2026-10-09`,
          snapshotOf: legacySource,
          "entry.scope": oldScope,
        },
      },
    );
    const legacy = await readDailyJournalWeek(db, configured, "2026-10-05", at);
    expect(legacy?.weather.days).toHaveLength(1);
    expect(legacy?.journal?.transport).toMatchObject({
      status: "AVAILABLE",
      lines: [{ id: "IDFM:C01383", capturedAt: at.toISOString() }],
    });
    // A new collection uses the stable geographical key; a subsequent switch
    // cannot remove weather or let a disabled line appear as still followed.
    await collectDailyJournal(
      database,
      { read: live },
      settings.storeId,
      new Date("2026-10-09T08:01:00Z"),
    );
    const changed = {
      ...configured,
      transports: {
        ...configured.transports,
        lines: [
          { ...configured.transports.lines[0]!, enabled: false },
          {
            ...configured.transports.lines[0]!,
            id: "IDFM:C00001",
            name: "New",
            enabled: true,
          },
        ],
      },
    };
    const result = await readDailyJournalWeek(db, changed, "2026-10-05", at);
    expect(result?.weather.days).toHaveLength(1);
    expect(result?.journal?.transport).toMatchObject({
      status: "UNAVAILABLE",
      issue: "HISTORY_UNAVAILABLE",
      lines: [
        {
          id: "IDFM:C00001",
          status: "UNAVAILABLE",
          capturedAt: null,
          disruptions: [],
        },
      ],
    });
    const invalidLocation = {
      ...configured,
      transports: {
        ...configured.transports,
        address: null,
        location: {
          ...configured.transports.location,
          source: "STORE_GPS" as const,
        },
      },
    };
    expect(
      (await readDailyJournalWeek(db, invalidLocation, "2026-10-05", at))
        ?.journal?.transport,
    ).toMatchObject({ issue: "LOCATION_CHANGED", lines: [] });
    const cleared = await readDailyJournalWeek(
      db,
      { ...settings, transports: null },
      "2026-10-05",
      at,
    );
    expect(cleared?.weather.days).toHaveLength(1);
    expect(cleared?.journal?.transport).toBe("NOT_CONFIGURED");
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
