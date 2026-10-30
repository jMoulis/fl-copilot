import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildProductDailyPerformance,
  buildDepartmentDailyPerformance,
  DEPARTMENT_COVERAGE_REVISION,
} from "@fl-copilot/analytics-core";
import { productDailyGoldenFixture } from "../../../packages/test-fixtures/src/product-daily";
import { refreshDepartmentCoverage } from "../src/analytics/remote-confirmation";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("historical department source-channel coverage", () => {
  let client: MongoClient, db: Db;
  const clock = new Date("2026-10-30T12:00:00Z");
  const database = {
    getDb: async () => db,
    close: async () => {},
    checkHealth: async () => "connected" as const,
  };
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_coverage_${randomUUID().replaceAll("-", "")}`);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  async function fixture(days: number) {
    const storeId = randomUUID();
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.UTC(2026, 0, i + 1))
        .toISOString()
        .slice(0, 10);
      const sale = {
        ...buildProductDailyPerformance({
          ...productDailyGoldenFixture,
          wasteObservations: [],
        }),
        storeId,
        date,
      };
      const waste = {
        ...buildProductDailyPerformance({
          ...productDailyGoldenFixture,
          salesObservations: [],
        }),
        storeId,
        date,
        productId: randomUUID(),
      };
      for (const p of [sale, waste])
        await db
          .collection("productDailyPerformance")
          .insertOne({ storeId, date, productId: p.productId, performance: p });
      const performance = buildDepartmentDailyPerformance({
        storeId,
        businessDate: date,
        productPerformances: [sale, waste],
        computedAt: clock.toISOString(),
      });
      const legacy = {
        ...performance,
        availability: {
          ...performance.availability,
          salesValue: {
            ...performance.availability.salesValue,
            status: "PARTIAL" as const,
          },
        },
      };
      await db.collection("departmentDailyPerformance").insertOne({
        storeId,
        date,
        inputRevision: "legacy",
        performance: legacy,
        computedAt: clock,
      });
    }
    return storeId;
  }
  it("refreshes only the requested store, preserves money and sources, and is idempotent", async () => {
    const storeId = await fixture(1),
      other = await fixture(1);
    const before = await db
      .collection("productDailyPerformance")
      .find({})
      .toArray();
    expect(
      await refreshDepartmentCoverage(database, storeId, () => clock),
    ).toBe(1);
    const row = await db
      .collection("departmentDailyPerformance")
      .findOne({ storeId });
    expect(row?.performance.sales.salesValue).toBe("60.50");
    expect(row?.performance.availability.salesValue).toMatchObject({
      status: "AVAILABLE",
      inputCount: 1,
    });
    expect(row?.inputRevision.startsWith(DEPARTMENT_COVERAGE_REVISION)).toBe(
      true,
    );
    expect(
      await refreshDepartmentCoverage(database, storeId, () => clock),
    ).toBe(0);
    expect(
      (
        await db
          .collection("departmentDailyPerformance")
          .findOne({ storeId: other })
      )?.inputRevision,
    ).toBe("legacy");
    expect(
      await db.collection("productDailyPerformance").find({}).toArray(),
    ).toEqual(before);
    expect(await db.collection("syncChanges").countDocuments()).toBe(0);
    expect(await db.collection("salesObservations").countDocuments()).toBe(0);
  });
  it("bounds each pass, resumes the remainder and keeps an incomplete bootstrap intact", async () => {
    const storeId = await fixture(17);
    const incompleteStore = await fixture(1);
    await db
      .collection("productDailyPerformance")
      .deleteOne({ storeId: incompleteStore });
    expect(
      await refreshDepartmentCoverage(database, incompleteStore, () => clock),
    ).toBe(0);
    expect(
      (
        await db
          .collection("departmentDailyPerformance")
          .findOne({ storeId: incompleteStore })
      )?.inputRevision,
    ).toBe("legacy");
    const first = await refreshDepartmentCoverage(
      database,
      storeId,
      () => clock,
    );
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(16);
    let total = first;
    for (let i = 0; i < 17 && total < 17; i++)
      total += await refreshDepartmentCoverage(database, storeId, () => clock);
    expect(total).toBe(17);
  });
});
