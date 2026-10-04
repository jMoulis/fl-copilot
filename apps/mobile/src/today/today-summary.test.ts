import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDepartmentDailyPerformance,
  normalizeDecimal,
  type MetricAvailability,
  type ProductDailyPerformance,
} from "@fl-copilot/analytics-core";
import { runLocalMigrations } from "../db/migrations";
import { TodaySummaryRepository, type TodayDatabase } from "./today-summary";

type SQLiteValue = string | number | null;

class NodeDatabase implements TodayDatabase {
  constructor(readonly database: DatabaseSync) {}

  async getFirstAsync<T>(sql: string, ...params: unknown[]) {
    return (
      (this.database.prepare(sql).get(...asSQLiteValues(params)) as
        T | undefined) ?? null
    );
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]) {
    return this.database.prepare(sql).all(...asSQLiteValues(params)) as T[];
  }

  async execAsync(sql: string) {
    this.database.exec(sql);
  }
}

const directories: string[] = [];
const storeId = "store-1";
const productId = "product-1";
const secondProductId = "product-2";
const computedAt = "2026-10-04T09:00:00.000Z";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Today summary", () => {
  it("returns an empty state when no analytical day exists", async () => {
    const { adapter, database } = await openDatabase();
    await expect(
      new TodaySummaryRepository(adapter).load(storeId),
    ).resolves.toBeNull();
    database.close();
  });

  it("selects the latest day, compares J-7 and keeps at most three priorities", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, productId, "Tomate ronde");
    insertProduct(database, secondProductId, "Fraise barquette");
    const reference = productPerformance("2026-09-26", {
      sales: "800.00",
      margin: "240.00",
      waste: "20.00",
    });
    const current = productPerformance("2026-10-03", {
      sales: "700.00",
      margin: "180.00",
      waste: "60.00",
    });
    insertPerformance(database, reference);
    insertPerformance(database, current);
    insertPerformance(
      database,
      productPerformance(
        "2026-09-26",
        { sales: "800.00", margin: "240.00", waste: "20.00" },
        secondProductId,
      ),
    );
    insertPerformance(
      database,
      productPerformance(
        "2026-10-03",
        { sales: "800.00", margin: "240.00", waste: "100.00" },
        secondProductId,
      ),
    );

    const summary = await new TodaySummaryRepository(adapter).load(storeId);

    expect(summary).toMatchObject({
      businessDate: "2026-10-03",
      origin: "LOCAL",
      productCount: 2,
    });
    expect(
      summary?.kpis.map(({ id, value, comparison }) => ({
        id,
        value,
        difference: comparison.absoluteDifference,
        percentage: comparison.percentageDifference,
      })),
    ).toEqual([
      {
        id: "sales",
        value: "1500.00",
        difference: "-100.00",
        percentage: "-6.25",
      },
      {
        id: "margin",
        value: "420.00",
        difference: "-60.00",
        percentage: "-12.50",
      },
      {
        id: "waste",
        value: "160.00",
        difference: "120.00",
        percentage: "300.00",
      },
    ]);
    expect(summary?.priorities.map((priority) => priority.type)).toEqual([
      "WASTE_SPIKE",
      "WASTE_SPIKE",
      "MARGIN_DROP",
    ]);
    expect(summary?.priorities).toHaveLength(3);
    expect(
      summary?.priorities.find(
        (priority) =>
          priority.productId === productId && priority.type === "MARGIN_DROP",
      ),
    ).toMatchObject({
      currentValue: "180",
      referenceValue: "240",
      absoluteDifference: "-60",
      percentageDifference: "-25.00",
      incompleteMetricLabels: [],
    });
    expect(summary?.movements.map((movement) => movement.metric)).toEqual([
      "SALES",
      "WASTE",
      "MARGIN",
      "WASTE",
    ]);
    expect(summary?.dataQuality.alertMessage).toBeNull();
    database.close();
  });

  it("does not invent a J-7 variation and surfaces incomplete KPI data", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, productId, "Tomate ronde");
    insertPerformance(
      database,
      productPerformance("2026-10-03", {
        sales: "700.00",
        margin: null,
        waste: null,
      }),
    );

    const summary = await new TodaySummaryRepository(adapter).load(storeId);

    expect(
      summary?.kpis.every((kpi) => kpi.comparison.status === "UNAVAILABLE"),
    ).toBe(true);
    expect(
      summary?.kpis.every(
        (kpi) => kpi.comparison.percentageDifference === null,
      ),
    ).toBe(true);
    expect(summary?.movements).toEqual([]);
    expect(summary?.dataQuality.incompleteKpiLabels).toEqual([
      "Marge",
      "Casse au PA",
    ]);
    expect(summary?.dataQuality.alertMessage).toContain("données incomplètes");
    database.close();
  });

  it("attaches incomplete product metrics to a deterministic signal", async () => {
    const { adapter, database } = await openDatabase();
    insertProduct(database, productId, "Banane vrac");
    insertPerformance(
      database,
      productPerformance("2026-09-26", {
        sales: "800.00",
        margin: "240.00",
        waste: null,
      }),
    );
    insertPerformance(
      database,
      productPerformance("2026-10-03", {
        sales: "700.00",
        margin: "180.00",
        waste: null,
      }),
    );

    const summary = await new TodaySummaryRepository(adapter).load(storeId);
    const marginPriority = summary?.priorities.find(
      (priority) => priority.type === "MARGIN_DROP",
    );

    expect(marginPriority).toMatchObject({
      productLabel: "Banane vrac",
      status: "LOW_QUALITY",
      currentValue: "180",
      referenceValue: "240",
      incompleteMetricLabels: ["Casse au PA"],
    });
    database.close();
  });
});

async function openDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-today-"));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  const adapter = new NodeDatabase(database);
  await runLocalMigrations(adapter);
  return { adapter, database };
}

function insertProduct(database: DatabaseSync, id: string, label: string) {
  database
    .prepare(
      `
    INSERT INTO products (
      id, store_id, label, category, nature, sales_unit, status, version,
      created_at, updated_at, deleted_at, sync_state, dirty
    ) VALUES (?, ?, ?, 'VEGETABLE', 'BULK', 'KG', 'ACTIVE', 1, ?, ?, NULL, 'SYNCED', 0)
  `,
    )
    .run(id, storeId, label, computedAt, computedAt);
}

function insertPerformance(
  database: DatabaseSync,
  performance: ProductDailyPerformance,
) {
  database
    .prepare(
      `
    INSERT INTO product_daily_performance (
      id, store_id, product_id, business_date, payload_json, origin,
      formula_version, input_revision, computed_at
    ) VALUES (?, ?, ?, ?, ?, 'LOCAL', ?, ?, ?)
  `,
    )
    .run(
      `product-day:${performance.productId}:${performance.date}`,
      storeId,
      performance.productId,
      performance.date,
      JSON.stringify(performance),
      performance.formulaVersion,
      performance.inputRevision,
      computedAt,
    );
  const productPerformances = database
    .prepare(
      "SELECT payload_json FROM product_daily_performance WHERE store_id = ? AND business_date = ? ORDER BY product_id",
    )
    .all(storeId, performance.date)
    .map((row) =>
      JSON.parse((row as { payload_json: string }).payload_json),
    ) as ProductDailyPerformance[];
  const department = buildDepartmentDailyPerformance({
    storeId,
    businessDate: performance.date,
    productPerformances,
    computedAt,
  });
  database
    .prepare(
      `
    INSERT INTO department_daily_performance (
      id, store_id, business_date, payload_json, origin,
      formula_version, input_revision, computed_at
    ) VALUES (?, ?, ?, ?, 'LOCAL', ?, ?, ?)
    ON CONFLICT(store_id, business_date) DO UPDATE SET
      payload_json = excluded.payload_json,
      formula_version = excluded.formula_version,
      input_revision = excluded.input_revision,
      computed_at = excluded.computed_at
  `,
    )
    .run(
      `department-day:${performance.date}`,
      storeId,
      performance.date,
      JSON.stringify(department),
      department.formulaVersion,
      department.inputRevision,
      computedAt,
    );
}

function productPerformance(
  date: string,
  values: { sales: string | null; margin: string | null; waste: string | null },
  requestedProductId = productId,
): ProductDailyPerformance {
  const sales = decimal(values.sales);
  const margin = decimal(values.margin);
  const waste = decimal(values.waste);
  return {
    storeId,
    productId: requestedProductId,
    date,
    sales: {
      quantity: sales === null ? null : normalizeDecimal("10"),
      quantityUnit: sales === null ? null : "KG",
      salesValue: sales,
      purchaseValue: null,
      marginValue: margin,
      marginRate: null,
    },
    waste: {
      quantity: waste === null ? null : normalizeDecimal("1"),
      quantityUnit: waste === null ? null : "KG",
      purchaseValueKnown: waste,
      purchaseValueEstimated: null,
      salesValue: null,
    },
    availability: {
      salesQuantity: availability(sales),
      salesValue: availability(sales),
      salesPurchaseValue: availability(null),
      salesMarginValue: availability(margin),
      salesMarginRate: unavailableAggregation(),
      wasteQuantity: availability(waste),
      wastePurchaseValueKnown: availability(waste),
      wastePurchaseValueEstimated: availability(null),
      wasteSalesValue: availability(null),
    },
    commercialOperationIds: [],
    merchandisingPlanIds: [],
    contextEventIds: [],
    marketSignalIds: [],
    storeProductEventIds: [],
    weatherRecordId: null,
    sourceLineageIds: [`source:${requestedProductId}:${date}`],
    inputRevision: `input:${requestedProductId}:${date}`,
    formulaVersion: "product-daily-v1",
    computedAt,
  };
}

function decimal(value: string | null) {
  return value === null ? null : normalizeDecimal(value);
}

function availability(value: string | null): MetricAvailability {
  return value === null
    ? {
        status: "UNAVAILABLE",
        inputCount: 1,
        availableInputCount: 0,
        missingInputCount: 1,
        reason: "MISSING_INPUT",
      }
    : {
        status: "AVAILABLE",
        inputCount: 1,
        availableInputCount: 1,
        missingInputCount: 0,
      };
}

function unavailableAggregation(): MetricAvailability {
  return {
    status: "UNAVAILABLE",
    inputCount: 1,
    availableInputCount: 0,
    missingInputCount: 1,
    reason: "AGGREGATION_NOT_VALIDATED",
  };
}

function asSQLiteValues(values: readonly unknown[]): SQLiteValue[] {
  return values.map((value) => {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      value === null
    ) {
      return value;
    }
    throw new Error("Unsupported SQLite test value.");
  });
}
