import {
  buildDepartmentDailyPerformance,
  buildProductDailyPerformance,
  serializeDepartmentDailyPerformance,
  serializeProductDailyPerformance,
  type ProductDailySalesObservation,
  type ProductDailyPerformance,
  type ProductDailyWasteObservation,
} from "@fl-copilot/analytics-core";
import type { Product, WasteObservation } from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";

export const ANALYTICS_RECOMPUTE_JOB_TYPE = "ANALYTICS_RECOMPUTE_PRODUCT_DATES";

export interface ProductDateScope {
  readonly productId: string;
  readonly businessDate: string;
}

export interface ProductDateRecomputer {
  recomputeProduct(storeId: string, scope: ProductDateScope): Promise<void>;
  recomputeDepartment(storeId: string, businessDate: string): Promise<void>;
}

export interface AnalyticsRecomputationJobPayload {
  readonly storeId: string;
  readonly scopes: readonly ProductDateScope[];
  readonly sourceDocumentId?: string;
}

type RecomputationDatabase = OutboxDatabase & AtomicMutationDatabase;

interface PendingJobRow {
  readonly id: string;
  readonly payload_json: string;
  readonly attempt_count: number;
}

interface ProductRow {
  readonly id: string;
  readonly store_id: string;
  readonly label: string;
  readonly category: Product["category"];
  readonly nature: Product["nature"];
  readonly sales_unit: Product["salesUnit"];
  readonly packaging_quantity: string | null;
  readonly packaging_unit: NonNullable<Product["packaging"]>["unit"] | null;
  readonly packaging_source_label: string | null;
  readonly family_id: string | null;
  readonly subfamily_id: string | null;
  readonly status: Product["status"];
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

interface SalesObservationRow {
  readonly id: string;
  readonly store_id: string;
  readonly product_id: string;
  readonly business_date: string;
  readonly quantity: string;
  readonly purchase_value: string | null;
  readonly rce_value: string | null;
  readonly sales_value: string | null;
  readonly vat_value: string | null;
  readonly margin_value: string | null;
  readonly margin_rate: string | null;
  readonly source_document_id: string;
  readonly source_record_id: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

interface WasteObservationRow {
  readonly id: string;
  readonly store_id: string;
  readonly product_id: string;
  readonly business_date: string;
  readonly product_nature: WasteObservation["productNature"];
  readonly quantity: string | null;
  readonly purchase_value_known: string | null;
  readonly purchase_value_estimated: string | null;
  readonly sales_value: string | null;
  readonly cost_quality: WasteObservation["costQuality"];
  readonly source_type: WasteObservation["sourceType"];
  readonly source_document_id: string | null;
  readonly source_record_id: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export async function enqueueAnalyticsRecomputationJob(
  database: OutboxDatabase,
  input: {
    readonly jobId: string;
    readonly storeId: string;
    readonly scopes: readonly ProductDateScope[];
    readonly sourceDocumentId?: string;
    readonly createdAt: string;
  },
) {
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) {
    throw new Error("At least one product/date scope is required.");
  }
  const payload: AnalyticsRecomputationJobPayload = {
    storeId: input.storeId,
    scopes,
    ...(input.sourceDocumentId
      ? { sourceDocumentId: input.sourceDocumentId }
      : {}),
  };
  await database.runAsync(
    `
      INSERT INTO local_jobs (
        id, type, payload_json, status, attempt_count, next_attempt_at,
        last_error, created_at, updated_at
      ) VALUES (?, ?, ?, 'PENDING', 0, NULL, NULL, ?, ?)
    `,
    input.jobId,
    ANALYTICS_RECOMPUTE_JOB_TYPE,
    JSON.stringify(payload),
    input.createdAt,
    input.createdAt,
  );
  return payload;
}

export class LocalAnalyticsRecomputationScheduler {
  private readonly inFlight = new Map<
    string,
    Promise<AnalyticsRecomputationRun>
  >();

  constructor(
    private readonly database: OutboxDatabase,
    private readonly recomputer: ProductDateRecomputer,
    private readonly options: {
      readonly chunkSize?: number;
      readonly maximumAttempts?: number;
      readonly yieldToInterface?: () => Promise<void>;
      readonly now?: () => string;
    } = {},
  ) {}

  process(storeId: string): Promise<AnalyticsRecomputationRun> {
    const current = this.inFlight.get(storeId);
    if (current) return current;
    const run = this.processPending(storeId).finally(() => {
      this.inFlight.delete(storeId);
    });
    this.inFlight.set(storeId, run);
    return run;
  }

  private async processPending(
    storeId: string,
  ): Promise<AnalyticsRecomputationRun> {
    const chunkSize = boundedInteger(
      this.options.chunkSize ?? 10,
      "chunkSize",
      1,
      100,
    );
    const maximumAttempts = boundedInteger(
      this.options.maximumAttempts ?? 3,
      "maximumAttempts",
      1,
      10,
    );
    const now = this.options.now ?? (() => new Date().toISOString());
    const yieldToInterface =
      this.options.yieldToInterface ?? defaultYieldToInterface;
    const rows = await this.database.getAllAsync<PendingJobRow>(
      `
        SELECT id, payload_json, attempt_count
        FROM local_jobs
        WHERE type = ? AND status IN ('PENDING', 'RETRY')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          AND json_extract(payload_json, '$.storeId') = ?
        ORDER BY created_at, id
      `,
      ANALYTICS_RECOMPUTE_JOB_TYPE,
      now(),
      storeId,
    );

    let completedJobs = 0;
    let failedJobs = 0;
    let completedScopes = 0;
    for (const row of rows) {
      const claimedAt = now();
      const claim = await this.database.runAsync(
        `
          UPDATE local_jobs
          SET status = 'RUNNING', attempt_count = attempt_count + 1,
              last_error = NULL, updated_at = ?
          WHERE id = ? AND status IN ('PENDING', 'RETRY')
        `,
        claimedAt,
        row.id,
      );
      if (Number(claim.changes) !== 1) continue;

      try {
        const payload = parsePayload(row.payload_json, storeId);
        for (let index = 0; index < payload.scopes.length; index += 1) {
          await this.recomputer.recomputeProduct(
            storeId,
            payload.scopes[index]!,
          );
          completedScopes += 1;
          if (
            (index + 1) % chunkSize === 0 &&
            index + 1 < payload.scopes.length
          ) {
            await yieldToInterface();
          }
        }
        const businessDates = [
          ...new Set(payload.scopes.map((scope) => scope.businessDate)),
        ].sort();
        for (const businessDate of businessDates) {
          await this.recomputer.recomputeDepartment(storeId, businessDate);
        }
        await this.database.runAsync(
          `
            UPDATE local_jobs
            SET status = 'COMPLETED', next_attempt_at = NULL,
                last_error = NULL, updated_at = ?
            WHERE id = ?
          `,
          now(),
          row.id,
        );
        completedJobs += 1;
      } catch (error) {
        const attempt = row.attempt_count + 1;
        const status = attempt >= maximumAttempts ? "FAILED" : "RETRY";
        await this.database.runAsync(
          `
            UPDATE local_jobs
            SET status = ?, next_attempt_at = NULL,
                last_error = ?, updated_at = ?
            WHERE id = ?
          `,
          status,
          errorMessage(error),
          now(),
          row.id,
        );
        failedJobs += 1;
      }
    }

    return {
      attemptedJobs: rows.length,
      completedJobs,
      failedJobs,
      completedScopes,
    };
  }
}

export interface AnalyticsRecomputationRun {
  readonly attemptedJobs: number;
  readonly completedJobs: number;
  readonly failedJobs: number;
  readonly completedScopes: number;
}

export class SQLiteProductDateRecomputer implements ProductDateRecomputer {
  constructor(
    private readonly database: RecomputationDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async recomputeProduct(storeId: string, scope: ProductDateScope) {
    validateScope(scope);
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const productRow = await transaction.getFirstAsync<ProductRow>(
        `SELECT * FROM products WHERE id = ? AND store_id = ?`,
        scope.productId,
        storeId,
      );
      if (!productRow) {
        throw new Error(
          `Product ${scope.productId} is unavailable for local recomputation.`,
        );
      }
      const salesRows = await transaction.getAllAsync<SalesObservationRow>(
        `
          SELECT * FROM sales_observations
          WHERE store_id = ? AND product_id = ? AND business_date = ?
            AND validation_status = 'VALIDATED'
          ORDER BY id
        `,
        storeId,
        scope.productId,
        scope.businessDate,
      );
      const wasteRows = await transaction.getAllAsync<WasteObservationRow>(
        `
          SELECT * FROM waste_observations
          WHERE store_id = ? AND product_id = ? AND business_date = ?
            AND validation_status = 'VALIDATED'
          ORDER BY id
        `,
        storeId,
        scope.productId,
        scope.businessDate,
      );
      const computedAt = this.now();
      const performance = buildProductDailyPerformance({
        product: mapProduct(productRow),
        businessDate: scope.businessDate,
        salesObservations: salesRows.map(mapSalesObservation),
        wasteObservations: wasteRows.map(mapWasteObservation),
        computedAt,
      });
      await upsertProductPerformance(transaction, performance);
    });
  }

  async recomputeDepartment(storeId: string, businessDate: string) {
    validateScope({ productId: "department", businessDate });
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const productPerformances = await transaction.getAllAsync<{
        payload_json: string;
      }>(
        `
          SELECT payload_json FROM product_daily_performance
          WHERE store_id = ? AND business_date = ?
          ORDER BY product_id
        `,
        storeId,
        businessDate,
      );
      const computedAt = this.now();
      const department = buildDepartmentDailyPerformance({
        storeId,
        businessDate,
        productPerformances: productPerformances.map((row) =>
          parseProductPerformance(row.payload_json),
        ),
        computedAt,
      });
      await transaction.runAsync(
        `
          INSERT INTO department_daily_performance (
            id, store_id, business_date, payload_json, origin,
            formula_version, input_revision, computed_at
          ) VALUES (?, ?, ?, ?, 'LOCAL', ?, ?, ?)
          ON CONFLICT(store_id, business_date) DO UPDATE SET
            payload_json = excluded.payload_json,
            origin = excluded.origin,
            formula_version = excluded.formula_version,
            input_revision = excluded.input_revision,
            computed_at = excluded.computed_at
        `,
        `department-day:${storeId}:${businessDate}`,
        storeId,
        businessDate,
        serializeDepartmentDailyPerformance(department),
        department.formulaVersion,
        department.inputRevision,
        department.computedAt,
      );
    });
  }
}

async function upsertProductPerformance(
  database: OutboxDatabase,
  performance: ProductDailyPerformance,
) {
  await database.runAsync(
    `
      INSERT INTO product_daily_performance (
        id, store_id, product_id, business_date, payload_json, origin,
        formula_version, input_revision, computed_at
      ) VALUES (?, ?, ?, ?, ?, 'LOCAL', ?, ?, ?)
      ON CONFLICT(store_id, product_id, business_date) DO UPDATE SET
        payload_json = excluded.payload_json,
        origin = excluded.origin,
        formula_version = excluded.formula_version,
        input_revision = excluded.input_revision,
        computed_at = excluded.computed_at
    `,
    `product-day:${performance.storeId}:${performance.productId}:${performance.date}`,
    performance.storeId,
    performance.productId,
    performance.date,
    serializeProductDailyPerformance(performance),
    performance.formulaVersion,
    performance.inputRevision,
    performance.computedAt,
  );
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    storeId: row.store_id,
    label: row.label,
    category: row.category,
    nature: row.nature,
    salesUnit: row.sales_unit,
    packaging:
      row.packaging_quantity && row.packaging_unit
        ? {
            quantity: row.packaging_quantity,
            unit: row.packaging_unit,
            sourceLabel: row.packaging_source_label,
          }
        : null,
    familyId: row.family_id,
    subfamilyId: row.subfamily_id,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapSalesObservation(
  row: SalesObservationRow,
): ProductDailySalesObservation {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    businessDate: row.business_date,
    quantity: row.quantity,
    purchaseValue: row.purchase_value,
    salesValue: row.sales_value,
    marginValue: row.margin_value,
    marginRate: row.margin_rate,
    sourceRecordId: row.source_record_id,
    validationStatus: "VALIDATED",
    version: row.version,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapWasteObservation(
  row: WasteObservationRow,
): ProductDailyWasteObservation {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    businessDate: row.business_date,
    quantity: row.quantity,
    purchaseValueKnown: row.purchase_value_known,
    purchaseValueEstimated: row.purchase_value_estimated,
    salesValue: row.sales_value,
    costQuality: row.cost_quality,
    sourceRecordId: row.source_record_id,
    validationStatus: "VALIDATED",
    version: row.version,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function parseProductPerformance(value: string): ProductDailyPerformance {
  const parsed = JSON.parse(value) as ProductDailyPerformance;
  if (!parsed.storeId || !parsed.productId || !parsed.date) {
    throw new Error("Invalid cached product daily performance.");
  }
  return parsed;
}

function parsePayload(
  value: string,
  expectedStoreId: string,
): AnalyticsRecomputationJobPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid analytics recomputation payload JSON.");
  }
  if (!isRecord(parsed) || parsed.storeId !== expectedStoreId) {
    throw new Error("Analytics recomputation payload has an invalid store.");
  }
  if (!Array.isArray(parsed.scopes)) {
    throw new Error("Analytics recomputation payload has no scopes.");
  }
  const scopes = normalizeScopes(
    parsed.scopes.map((scope) => {
      if (
        !isRecord(scope) ||
        typeof scope.productId !== "string" ||
        typeof scope.businessDate !== "string"
      ) {
        throw new Error(
          "Analytics recomputation payload has an invalid scope.",
        );
      }
      return {
        productId: scope.productId,
        businessDate: scope.businessDate,
      };
    }),
  );
  if (scopes.length === 0) {
    throw new Error("Analytics recomputation payload has no scopes.");
  }
  return {
    storeId: expectedStoreId,
    scopes,
    ...(typeof parsed.sourceDocumentId === "string"
      ? { sourceDocumentId: parsed.sourceDocumentId }
      : {}),
  };
}

function normalizeScopes(
  scopes: readonly ProductDateScope[],
): readonly ProductDateScope[] {
  const byKey = new Map<string, ProductDateScope>();
  for (const scope of scopes) {
    validateScope(scope);
    byKey.set(`${scope.businessDate}:${scope.productId}`, {
      productId: scope.productId,
      businessDate: scope.businessDate,
    });
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.businessDate.localeCompare(right.businessDate) ||
      left.productId.localeCompare(right.productId),
  );
}

function validateScope(scope: ProductDateScope) {
  if (scope.productId.trim().length === 0) {
    throw new Error("Analytics recomputation productId is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate)) {
    throw new Error(`Invalid analytics business date: ${scope.businessDate}.`);
  }
  const date = new Date(`${scope.businessDate}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== scope.businessDate
  ) {
    throw new Error(`Invalid analytics business date: ${scope.businessDate}.`);
  }
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultYieldToInterface() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
