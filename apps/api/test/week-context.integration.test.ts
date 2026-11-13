import { readTransportContext } from "../src/context/transport-traffic";
import { storeTransportsFixture } from "../../../scripts/test-store-transports-fixtures";
import { readJournalContext } from "../src/context/journal";
import { gzipSync } from "node:zlib";
import { readObservedWeather } from "../src/context/observed-weather";
import { readFileSync } from "node:fs";
import { readEconomicContext } from "../src/context/economy";
import { readCopilotWeek } from "../src/copilot/week-context-tool";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import { metForecastFixture } from "../../../scripts/test-weekly-context-fixtures";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createWeekContextService } from "../src/context/week-context";
import { ContextProviderCache } from "../src/context/provider-cache";
import { z } from "zod";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("remote context cache", () => {
  let database: DatabaseService;
  beforeAll(async () => {
    database = createMongoDatabase(
      parseEnvironment({
        NODE_ENV: "test",
        MONGODB_URI: uri,
        MONGODB_DATABASE: `flc_ctx_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      }),
    );
    await database.getDb();
  });
  afterAll(async () => {
    try {
      await (await database.getDb()).dropDatabase();
    } finally {
      await database.close();
    }
  });
  beforeEach(async () => {
    await (
      await database.getDb()
    )
      .collection("contextProviderCache")
      .deleteMany({});
  });
  it("loads store-specific providers, caches across devices and keeps a failed source independent", async () => {
    const settings = storeContextFixture(),
      db = await database.getDb();
    await db.collection("storeContextSettings").insertOne(settings);
    let at = new Date("2026-10-09T08:00:00Z"),
      fail = false;
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      expect(init?.headers).toMatchObject({
        "User-Agent": expect.stringContaining("fl-copilot"),
      });
      if (url.includes("geo.api"))
        return Response.json([
          {
            nom: "Asnières-sur-Seine",
            code: "92004",
            centre: { coordinates: [2.2935, 48.9181] },
          },
        ]);
      if (url.includes("api.met.no")) {
        if (fail) throw Error("provider down");
        return Response.json(metForecastFixture(), {
          headers: {
            expires: "Fri, 09 Oct 2026 09:00:00 GMT",
            "last-modified": "Fri, 09 Oct 2026 07:00:00 GMT",
          },
        });
      }
      if (url.includes("jours-feries"))
        return Response.json({ "2026-11-11": "Armistice" });
      return Response.json({ total_count: 0, results: [] });
    };
    const service = createWeekContextService(database, fetcher, () => at),
      first = await service.read(settings.storeId, "2026-10-05");
    expect(first.weather.status).toBe("AVAILABLE");
    expect(
      first.weather.days.find((d) => d.validDate === "2026-10-10")
        ?.precipitationMm,
    ).toBe(0);
    expect(first.publicHolidays.days).toEqual([]);
    expect(first.schoolHolidays.status).toBe("AVAILABLE");
    expect(calls).toHaveLength(4);
    await createWeekContextService(database, fetcher, () => at).read(
      settings.storeId,
      "2026-10-05",
    );
    expect(calls).toHaveLength(4);
    const copilot = await readCopilotWeek(
      service,
      settings.storeId,
      { weekStart: "2026-10-05" },
      at,
    );
    expect(copilot.context?.weather.status).toBe("AVAILABLE");
    expect(copilot.context).not.toHaveProperty("settingsFingerprint");
    expect(copilot.evidence).toHaveLength(4);
    expect(calls).toHaveLength(9);
    at = new Date("2026-10-09T10:00:00Z");
    fail = true;
    const stale = await service.read(settings.storeId, "2026-10-05");
    expect(stale.weather).toMatchObject({
      status: "STALE",
      issuedAt: first.weather.issuedAt,
      retrievedAt: first.weather.retrievedAt,
      days: first.weather.days,
    });
    expect(stale.schoolHolidays.status).toBe("AVAILABLE");
    const projected = await readCopilotWeek(
      service,
      settings.storeId,
      { weekStart: "2026-10-05" },
      at,
    );
    expect(projected.context?.weather.status).toBe("STALE");
    expect(projected.context?.schoolHolidays.status).toBe("AVAILABLE");
    await expect(
      service.read(randomUUID(), "2026-10-05"),
    ).rejects.toMatchObject({ publicCode: "STORE_SETTINGS_NOT_SYNCED" });
    expect(await db.collection("commercialWeekPlans").countDocuments()).toBe(0);
  });
  it("retains past daily transit captures even when a current line publishes more than forty updates", async () => {
    const db = await database.getDb(),
      settings = {
        ...storeContextFixture(),
        transports: storeTransportsFixture(),
      };
    let at = new Date("2026-11-12T10:00:00Z");
    const fetcher: typeof fetch = async () =>
      Response.json({
        line_reports: [
          {
            line: {
              id: "line:IDFM:C01383",
              links: [{ type: "disruption", id: "work" }],
            },
          },
        ],
        disruptions: [
          {
            id: "work",
            messages: [{ text: "Annonce de travaux" }],
            application_periods: [
              { begin: "20261112T220000", end: "20261113T020000" },
            ],
          },
        ],
      });
    const first = await readTransportContext(
      db,
      settings,
      "2026-11-15",
      "controlled-test-key",
      fetcher,
      () => at,
    );
    expect(first).toMatchObject({ status: "AVAILABLE" });
    const snapshot = await db
      .collection("contextProviderCache")
      .findOne({ snapshotOf: { $regex: "^https://prim" } });
    expect(snapshot).toBeTruthy();
    await db.collection("contextProviderCache").insertMany(
      Array.from({ length: 60 }, (_, i) => ({
        url: `transit-test-capture-${i}`,
        snapshotOf: snapshot!.snapshotOf,
        firstCapturedAt: new Date(
          Date.parse("2026-11-13T00:00:00Z") + i * 600000,
        ).toISOString(),
        revision: "a".repeat(64),
        payload: snapshot!.payload,
      })),
    );
    at = new Date("2026-11-13T20:00:00Z");
    const next = await readTransportContext(
      db,
      settings,
      "2026-11-15",
      "controlled-test-key",
      fetcher,
      () => at,
    );
    expect(next).not.toBe("NOT_CONFIGURED");
    if (typeof next !== "string")
      expect(
        next.lines[0]?.history?.some(
          (h) => h.capturedAt === "2026-11-12T10:00:00.000Z",
        ),
      ).toBe(true);
  });
  it("archives the real Journal sources with shared TTL, 304, history, store scope and outage recovery", async () => {
    const db = await database.getDb();
    const settings = storeContextFixture();
    const fixture = (name: string) =>
      readFileSync(
        new URL(
          `../../../scripts/fixtures/journal/${name}.html`,
          import.meta.url,
        ),
        "utf8",
      );
    let at = new Date("2026-11-13T09:00:00Z"),
      calls = 0,
      mode = "ok";
    const fetcher: typeof fetch = async (input) => {
      calls++;
      if (mode === "fail") throw Error("offline");
      if (mode === "304") return new Response(null, { status: 304 });
      const url = String(input);
      const name = url.includes("franceagrimer")
        ? "franceagrimer-consumption-2026-11-13"
        : url.includes("travaux")
          ? "asnieres-works-2026-11-12"
          : "asnieres-agenda-2026-11-13";
      return new Response(fixture(name), {
        headers: {
          "content-type": "text/html",
          "last-modified": "Fri, 13 Nov 2026 08:00:00 GMT",
        },
      });
    };
    const read = () =>
      readJournalContext(
        db,
        new ContextProviderCache(db, fetcher, () => at),
        settings,
        "2026-11-15",
        at,
      );
    const first = await read();
    expect(first.sources.every((s) => s.status === "AVAILABLE")).toBe(true);
    await read();
    expect(calls).toBe(3);
    expect(
      await db
        .collection("contextProviderCache")
        .countDocuments({ snapshotOf: { $exists: true } }),
    ).toBe(3);
    mode = "304";
    at = new Date("2026-11-14T10:00:00Z");
    const second = await read();
    expect(second.sources.map((s) => s.revision)).toEqual(
      first.sources.map((s) => s.revision),
    );
    expect(second.sources.every((s) => s.history.length === 2)).toBe(true);
    mode = "fail";
    at = new Date("2026-11-15T12:00:00Z");
    const stale = await read();
    expect(stale.sources.every((s) => s.status === "STALE" && s.payload)).toBe(
      true,
    );
    const old = await readJournalContext(
      db,
      new ContextProviderCache(db, fetcher, () => at),
      settings,
      "2026-11-08",
      at,
    );
    expect(old.sources[0]).toMatchObject({
      payload: null,
      issue: "HISTORY_UNAVAILABLE",
    });
    const other = await readJournalContext(
      db,
      new ContextProviderCache(db, fetcher, () => at),
      { ...settings, city: "Paris", postalCode: "75001" },
      "2026-11-15",
      at,
    );
    expect(other.sources[0]?.status).toBe("NOT_CONFIGURED");
  });
  it("shares the normalized INSEE cache across devices and retains its real values after timeout/304", async () => {
    const db = await database.getDb();
    const xml = readFileSync(
      new URL(
        "../../../scripts/fixtures/insee-monthly-2026-11-13.xml",
        import.meta.url,
      ),
      "utf8",
    );
    let at = new Date("2026-11-13T08:00:00Z"),
      calls = 0,
      mode = "ok";
    const fetcher: typeof fetch = async (_input, init) => {
      calls++;
      expect(new Headers(init?.headers).get("accept")).toContain(
        "structurespecificdata+xml",
      );
      if (mode === "fail") throw Error("network lost");
      if (mode === "304") return new Response(null, { status: 304 });
      return new Response(xml, {
        headers: {
          "content-type": "application/xml",
          expires: "Fri, 01 Jan 2038 00:00:00 GMT",
          "last-modified": "Fri, 13 Nov 2026 08:00:00 GMT",
        },
      });
    };
    const read = () =>
      readEconomicContext(
        new ContextProviderCache(db, fetcher, () => at),
        "2026-11-09",
        "2026-11-15",
        at,
      );
    const first = await read();
    expect(first.status).toBe("AVAILABLE");
    expect(first.validUntil).toBe("2026-11-14T08:00:00.000Z");
    expect((await read()).series).toEqual(first.series);
    expect(calls).toBe(1);
    at = new Date("2026-11-14T09:00:00Z");
    mode = "fail";
    const stale = await read();
    expect(stale).toMatchObject({
      status: "STALE",
      retrievedAt: first.retrievedAt,
      series: first.series,
    });
    await read();
    expect(calls).toBe(2);
    at = new Date("2026-11-14T09:02:00Z");
    mode = "304";
    const renewed = await read();
    expect(renewed.status).toBe("AVAILABLE");
    expect(renewed.series).toEqual(first.series);
    expect(calls).toBe(3);
    expect(await db.collection("contextProviderCache").countDocuments()).toBe(
      1,
    );
    expect(await db.collection("commercialWeekPlans").countDocuments()).toBe(0);
  });
  it("shares real-format weather archives, retains provenance through failure and renews 304 without inventing a new download", async () => {
    const db = await database.getDb(),
      csv = readFileSync(
        new URL(
          "../../../scripts/fixtures/meteofrance-92-sample.csv",
          import.meta.url,
        ),
        "utf8",
      );
    const url =
      "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_92_latest-2025-2026_RR-T-Vent.csv.gz";
    let at = new Date("2026-11-13T08:00:00Z"),
      mode = "ok",
      calls = 0;
    const fetcher: typeof fetch = async (input) => {
      calls++;
      if (mode === "fail") throw Error("network lost");
      if (mode === "304") return new Response(null, { status: 304 });
      return String(input).includes("data.gouv.fr/api")
        ? Response.json({ resources: [{ url }] })
        : new Response(gzipSync(csv), {
            headers: {
              "content-type": "application/gzip",
              "last-modified": "Thu, 12 Nov 2026 07:27:12 GMT",
            },
          });
    };
    const read = () =>
      readObservedWeather(
        new ContextProviderCache(db, fetcher, () => at),
        { latitude: 48.9181, longitude: 2.2935 },
        "92",
        "2026-09-28",
        "2026-10-04",
        at,
      );
    const first = await read();
    expect(first.status).toBe("AVAILABLE");
    expect(first.days).toHaveLength(2);
    expect((await read()).days).toEqual(first.days);
    expect(calls).toBe(2);
    at = new Date("2026-11-14T09:00:00Z");
    mode = "fail";
    const stale = await read();
    expect(stale.status).toBe("STALE");
    expect(stale.days).toEqual(first.days);
    await read();
    expect(calls).toBe(4);
    at = new Date("2026-11-14T09:02:00Z");
    mode = "304";
    const renewed = await read();
    expect(renewed.status).toBe("AVAILABLE");
    expect(renewed.days).toEqual(first.days);
    expect(calls).toBe(6);
    expect(await db.collection("contextProviderCache").countDocuments()).toBe(
      2,
    );
    expect(await db.collection("commercialWeekPlans").countDocuments()).toBe(0);
  });
  it("handles school-zone boundaries, year-crossing holidays and truncated responses safely", async () => {
    const settings = storeContextFixture(),
      db = await database.getDb();
    await db.collection("storeContextSettings").insertOne(settings);
    let truncated = false;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("geo.api")) return Response.json([]);
      if (url.includes("jours-feries"))
        return Response.json(
          url.includes("2027")
            ? { "2027-01-01": "1er janvier" }
            : { "2026-12-25": "Noël" },
        );
      return Response.json({
        total_count: truncated ? 101 : 2,
        results: [
          {
            description: "Vacances",
            population: "Élèves",
            zones: "Zone C",
            start_date: "2026-12-18T23:00:00Z",
            end_date: "2027-01-03T23:00:00Z",
          },
          {
            description: "Vacances",
            population: "Élèves",
            zones: "Zone C",
            start_date: "2026-12-18T23:00:00Z",
            end_date: "2027-01-03T23:00:00Z",
          },
        ],
      });
    };
    const service = createWeekContextService(
      database,
      fetcher,
      () => new Date("2026-10-09T08:00:00Z"),
    );
    const context = await service.read(settings.storeId, "2026-12-28");
    expect(context.weather.issue).toBe("CITY_NOT_FOUND");
    expect(context.publicHolidays.days).toEqual([
      { date: "2027-01-01", label: "1er janvier" },
    ]);
    expect(context.schoolHolidays.periods).toEqual([
      {
        label: "Vacances",
        population: "Élèves",
        startDate: "2026-12-19",
        resumeDate: "2027-01-04",
      },
    ]);
    const resume = await service.read(settings.storeId, "2027-01-04");
    expect(resume.schoolHolidays.periods).toEqual([]);
    truncated = true;
    const incomplete = await service.read(settings.storeId, "2027-01-11");
    expect(incomplete.schoolHolidays.status).toBe("UNAVAILABLE");
    await db
      .collection("storeContextSettings")
      .updateOne({ storeId: settings.storeId }, { $set: { schoolZone: null } });
    expect(
      (await service.read(settings.storeId, "2026-10-05")).schoolHolidays
        .status,
    ).toBe("NOT_CONFIGURED");
  });
  it("serializes concurrent provider refreshes and conditionally revalidates without erasing cached data", async () => {
    const db = await database.getDb();
    let at = new Date("2026-10-09T08:00:00Z"),
      calls = 0;
    let release!: () => void;
    const block = new Promise<void>((r) => {
      release = r;
    });
    const url = "https://example.invalid/context-cache-test",
      schema = z.object({ value: z.number() });
    const fetcher: typeof fetch = async (_input, init) => {
      calls++;
      if (calls === 1) {
        await block;
        return Response.json(
          { value: 5 },
          {
            headers: {
              expires: "Fri, 09 Oct 2026 09:00:00 GMT",
              "last-modified": "Fri, 09 Oct 2026 07:00:00 GMT",
            },
          },
        );
      }
      expect(init?.headers).toMatchObject({
        "If-Modified-Since": "Fri, 09 Oct 2026 07:00:00 GMT",
      });
      return new Response(null, {
        status: 304,
        headers: { expires: "Fri, 09 Oct 2026 11:00:00 GMT" },
      });
    };
    const cache = new ContextProviderCache(db, fetcher, () => at),
      a = cache.read(url, schema, 3600000);
    while (!calls) await new Promise((r) => setTimeout(r, 5));
    const b = await cache.read(url, schema, 3600000);
    expect(b.data).toBeNull();
    expect(calls).toBe(1);
    release();
    expect((await a).data).toEqual({ value: 5 });
    at = new Date("2026-10-09T10:00:00Z");
    expect(await cache.read(url, schema, 3600000)).toMatchObject({
      data: { value: 5 },
      failed: false,
      validUntil: "2026-10-09T11:00:00.000Z",
    });
    expect(calls).toBe(2);
  });
});
