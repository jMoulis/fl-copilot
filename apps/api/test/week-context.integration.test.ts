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
    await expect(
      service.read(randomUUID(), "2026-10-05"),
    ).rejects.toMatchObject({ publicCode: "STORE_SETTINGS_NOT_SYNCED" });
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
