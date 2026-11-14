import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { addContextDays, type WeeklyContext } from "@fl-copilot/domain";
import { previousIsoYearDate } from "@fl-copilot/analytics-core";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import { weeklyContextFixture } from "../../../scripts/test-weekly-context-fixtures";
import { observedWeatherContextFixture } from "../../../scripts/test-observed-weather-fixtures";
import { contextMonday, dailyJournalScope } from "../src/context/daily-journal";
import { createWeekContextService } from "../src/context/week-context";
import { readJournalAssociations } from "../src/copilot/journal-associations-tool";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "Journal association study on retained Mongo data",
  () => {
    let client: MongoClient, db: Db;
    const storeId = randomUUID(),
      foreign = randomUUID(),
      familyId = randomUUID(),
      productId = randomUUID();
    const dates = Array.from({ length: 28 }, (_, i) =>
      addContextDays("2026-10-05", i),
    );
    const refs = dates.map((d) => previousIsoYearDate(d)!);
    const all = [...dates, ...refs];
    const query = {
      startDate: dates[0]!,
      endDate: dates.at(-1)!,
      referenceMode: "YEAR_OVER_YEAR" as const,
      familyId: null as string | null,
    };
    const now = new Date("2026-11-14T12:00:00.000Z");
    const database = {
      getDb: async () => db,
      close: async () => {},
      checkHealth: async () => "connected" as const,
    };
    const network = vi.fn<typeof fetch>(async () => {
      throw Error("PROVIDER_MUST_NOT_RUN");
    });
    const service = () =>
      createWeekContextService(database, network, () => now);
    const settings = { ...storeContextFixture(), id: storeId, storeId };
    const snapshot = (date: string, product = false, tenant = storeId) => {
      const current = dates.indexOf(date),
        value = String(current < 0 ? 100 : 100 + current);
      const availability = {
        status: "AVAILABLE",
        inputCount: 1,
        availableInputCount: 1,
        missingInputCount: 0,
      };
      return {
        _id: `${tenant}/${product ? productId : "department"}/${date}`,
        storeId: tenant,
        ...(product ? { productId } : {}),
        date,
        performance: {
          storeId: tenant,
          ...(product ? { productId } : {}),
          date,
          formulaVersion: product ? "product-daily-v1" : "department-daily-v1",
          inputRevision: `revision-${date}`,
          computedAt: now.toISOString(),
          sales: { salesValue: value, marginValue: value },
          waste: { salesValue: null },
          availability: {
            salesValue: availability,
            salesMarginValue: availability,
            wasteSalesValue: { ...availability, status: "UNAVAILABLE" },
          },
        },
      };
    };
    async function saveContext(w: string, change?: (c: WeeklyContext) => void) {
      const c = weeklyContextFixture(settings),
        o = observedWeatherContextFixture();
      c.weekStart = w;
      c.weekEnd = addContextDays(w, 6);
      c.weather.days = [];
      c.observedWeather = o;
      o.days = [];
      const capture = `${addContextDays(w, 7)}T08:00:00.000Z`;
      for (const date of all.filter((d) => contextMonday(d) === w)) {
        const day = structuredClone(observedWeatherContextFixture().days[0]!);
        day.producerDate = date;
        day.rainfallWindow.from = `${date}T06:00:00.000Z`;
        day.rainfallWindow.to = `${addContextDays(date, 1)}T06:00:00.000Z`;
        day.sourceRetrievedAt = capture;
        day.measurements.TN = {
          sourceValue: "0",
          analysisValue: "0",
          quality: "VALIDATED",
          qualityCode: "1",
        };
        const tx = String(dates.includes(date) ? 10 + dates.indexOf(date) : 10);
        day.measurements.TX = {
          sourceValue: tx,
          analysisValue: tx,
          quality: "VALIDATED",
          qualityCode: "1",
        };
        o.days.push(day);
      }
      change?.(c);
      const scope = dailyJournalScope(settings),
        source = `journal-daily:${storeId}:${scope}`;
      await db
        .collection<Document & { _id: string }>("contextProviderCache")
        .replaceOne(
          { _id: w },
          {
            _id: w,
            url: `${source}:${addContextDays(w, 7)}`,
            snapshotOf: source,
            firstCapturedAt: capture,
            entry: {
              version: 1,
              storeId,
              scope,
              date: addContextDays(w, 7),
              firstCollectedAt: capture,
              lastCollectedAt: capture,
              contexts: [c],
            },
          },
          { upsert: true },
        );
    }
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(`fl_assoc_${randomUUID().replaceAll("-", "")}`);
    });
    afterAll(async () => {
      try {
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    });
    beforeEach(async () => {
      for (const name of [
        "departmentDailyPerformance",
        "productDailyPerformance",
        "contextProviderCache",
        "storeProductEvents",
        "products",
        "storeContextSettings",
      ])
        await db.collection<Document & { _id: string }>(name).deleteMany({});
      network.mockClear();
      await db
        .collection<Document & { _id: string }>("storeContextSettings")
        .insertOne({ _id: storeId, ...settings });
      await db
        .collection<Document & { _id: string }>("departmentDailyPerformance")
        .insertMany(all.map((d) => snapshot(d)));
      for (const w of new Set(all.map(contextMonday))) await saveContext(w);
    });
    it("uses exact ISO references and observed records without fetching providers or writing results", async () => {
      expect(refs[0]).toBe("2025-10-06");
      await db
        .collection<Document & { _id: string }>("departmentDailyPerformance")
        .insertMany(all.map((d) => snapshot(d, false, foreign)));
      const before = await db
        .collection<Document & { _id: string }>("contextProviderCache")
        .countDocuments();
      const result = await readJournalAssociations(
        db,
        service(),
        storeId,
        query,
        now,
      );
      expect(result.series[0]).toMatchObject({
        pairs: 28,
        weeks: 4,
        rho: 1,
        status: "ASSOCIATION_OBSERVED",
      });
      expect(result.series[1]).toMatchObject({
        rho: null,
        status: "UNDEFINED",
      });
      expect(result.evidence).toHaveLength(5);
      expect(network).not.toHaveBeenCalled();
      expect(
        await db
          .collection<Document & { _id: string }>("contextProviderCache")
          .countDocuments(),
      ).toBe(before);
      expect(
        (await readJournalAssociations(db, service(), storeId, query, now))
          .evidence,
      ).toEqual(result.evidence);
    });
    it("returns missing support rather than falling back to the live context reader", async () => {
      await db
        .collection<Document & { _id: string }>("contextProviderCache")
        .deleteMany({});
      const result = await readJournalAssociations(
        db,
        service(),
        storeId,
        query,
        now,
      );
      expect(
        result.series.every(
          (s) => s.pairs === 0 && s.status === "INSUFFICIENT_DATA",
        ),
      ).toBe(true);
      expect(network).not.toHaveBeenCalled();
      await expect(
        readJournalAssociations(db, { read: vi.fn() }, storeId, query, now),
      ).rejects.toThrow("STORED_READER_REQUIRED");
    });
    it("excludes mismatched holidays and unknown business points without imputing zero", async () => {
      await saveContext(contextMonday(dates[0]!), (c) => {
        c.publicHolidays.days = [
          { date: dates[0]!, label: "Controlled holiday fixture" },
        ];
      });
      await db
        .collection<Document & { _id: string }>("departmentDailyPerformance")
        .updateOne(
          { storeId, date: dates[1] },
          { $set: { "performance.availability.salesValue.status": "PARTIAL" } },
        );
      await db
        .collection<Document & { _id: string }>("departmentDailyPerformance")
        .updateOne(
          { storeId, date: refs[2] },
          { $set: { "performance.sales.salesValue": "0" } },
        );
      const result = await readJournalAssociations(
        db,
        service(),
        storeId,
        query,
        now,
      );
      expect(result.series[0]).toMatchObject({
        pairs: 25,
        excluded: { calendar: 1, business: 2, weather: 0 },
      });
      expect(result.series[2]?.pairs).toBe(27);
    });
    it("refuses mixed stations and unqualified measurements", async () => {
      await saveContext(contextMonday(dates[0]!), (c) => {
        c.observedWeather!.reference!.station.id = "75110001";
        for (const d of c.observedWeather!.days) d.station.id = "75110001";
      });
      const result = await readJournalAssociations(
        db,
        service(),
        storeId,
        query,
        now,
      );
      expect(result.stationIds).toHaveLength(2);
      expect(result.series.every((s) => s.pairs === 0)).toBe(true);
      await saveContext(contextMonday(dates[0]!), (c) => {
        const d = c.observedWeather!.days[0]!;
        d.measurements.TX.qualityCode = "2";
        d.measurements.TX.quality = "SUSPECT";
        d.measurements.TX.analysisValue = null;
      });
      const next = await readJournalAssociations(
        db,
        service(),
        storeId,
        query,
        now,
      );
      expect(next.series[0]).toMatchObject({
        pairs: 27,
        excluded: { weather: 1 },
      });
    });
    it("counts a real event interval by Paris date including before UTC midnight", async () => {
      const id = randomUUID();
      await db
        .collection<Document & { _id: string }>("storeProductEvents")
        .insertOne({
          _id: id,
          id,
          storeId,
          productId,
          type: "OUT_OF_STOCK",
          startedAt: "2026-10-04T22:30:00.000Z",
          endedAt: "2026-10-04T23:00:00.000Z",
          clientCapturedAt: "2026-10-05T08:00:00.000Z",
          createdAt: "2026-10-05T08:00:00.000Z",
          updatedAt: "2026-10-05T08:00:00.000Z",
          status: "CLOSED",
          severity: null,
          comment: null,
          source: "USER",
          sourceDocumentId: null,
          version: 1,
        });
      const result = await readJournalAssociations(
        db,
        service(),
        storeId,
        query,
        now,
      );
      expect(result.series[0]).toMatchObject({
        pairs: 28,
        withoutRecordedEvents: { pairs: 27, rho: 1 },
      });
    });
    it("uses shared observed-cohort family aggregation and protects missing member days", async () => {
      await db
        .collection<Document & { _id: string }>("products")
        .insertOne({ _id: productId, storeId, familyId });
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .insertMany(all.map((d) => snapshot(d, true)));
      const result = await readJournalAssociations(
        db,
        service(),
        storeId,
        { ...query, familyId },
        now,
      );
      expect(result.scope).toBe("CURRENT_PRODUCT_FAMILY");
      expect(result.series[0]?.rho).toBe(1);
      const second = randomUUID();
      await db
        .collection<Document & { _id: string }>("products")
        .insertOne({ _id: second, storeId, familyId });
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .insertMany(
          all
            .filter((d) => d !== dates[0])
            .map((d) => {
              const row = snapshot(d, true);
              return {
                ...row,
                _id: `${second}/${d}`,
                productId: second,
                performance: { ...row.performance, productId: second },
              };
            }),
        );
      const incomplete = await readJournalAssociations(
        db,
        service(),
        storeId,
        { ...query, familyId },
        now,
      );
      expect(incomplete.series[0]).toMatchObject({
        pairs: 27,
        excluded: { business: 1 },
      });
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .updateOne(
          { storeId, date: dates[0] },
          { $set: { "performance.storeId": foreign } },
        );
      await expect(
        readJournalAssociations(
          db,
          service(),
          storeId,
          { ...query, familyId },
          now,
        ),
      ).rejects.toThrow("SCOPE_INVALID");
    });
    it("refuses an unclosed day and a foreign stored context", async () => {
      await expect(
        readJournalAssociations(
          db,
          service(),
          storeId,
          { ...query, endDate: "2026-11-14" },
          now,
        ),
      ).rejects.toThrow("UNCLOSED_DAY");
      const original = service();
      await expect(
        readJournalAssociations(
          db,
          {
            ...original,
            readStored: async (s, w) => ({
              ...(await original.readStored!(s, w)),
              storeId: foreign,
            }),
          },
          storeId,
          query,
          now,
        ),
      ).rejects.toThrow("SCOPE_INVALID");
    });
    it("refuses an over-limit event cohort without calculating a truncated association", async () => {
      await db
        .collection<Document & { _id: string }>("storeProductEvents")
        .insertMany(
          Array.from({ length: 1001 }, (_, i) => ({
            _id: String(i),
            storeId,
            startedAt: "2026-10-05T00:00:00.000Z",
            endedAt: null,
          })),
        );
      const result = await readJournalAssociations(
        db,
        service(),
        storeId,
        query,
        now,
      );
      expect(result).toMatchObject({
        status: "LIMIT_EXCEEDED",
        series: [],
        evidence: [],
      });
    });
  },
);
