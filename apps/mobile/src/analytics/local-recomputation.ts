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
import {
  notifyOutboxChanged,
  type OutboxDatabase,
} from "../sync/outbox-repository";

export const ANALYTICS_RECOMPUTE_JOB_TYPE = "ANALYTICS_RECOMPUTE_PRODUCT_DATES";

export interface ProductDateScope {
  readonly productId: string;
  readonly businessDate: string;
}

export interface ProductDateRecomputer {
  recomputeProduct(storeId: string, scope: ProductDateScope): Promise<void>;
  /** Optional bounded atomic batch; uses the same canonical per-product formula. */
  recomputeProducts?(
    storeId: string,
    scopes: readonly ProductDateScope[],
  ): Promise<void>;
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

const activeRecomputations = new WeakMap<
  OutboxDatabase,
  Map<string, Promise<AnalyticsRecomputationRun>>
>();
export class LocalAnalyticsRecomputationScheduler {
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
    let cycles = activeRecomputations.get(this.database);
    if (!cycles) {
      cycles = new Map();
      activeRecomputations.set(this.database, cycles);
    }
    const current = cycles.get(storeId);
    if (current) return current;
    const run = this.processPending(storeId).finally(() => {
      cycles.delete(storeId);
    });
    cycles.set(storeId, run);
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
    // No scheduler is active for this database/store. A RUNNING claim left by
    // termination is safe to recompute: deterministic projections are upserts.
    await this.database.runAsync(
      `UPDATE local_jobs SET status='RETRY', next_attempt_at=NULL,
       last_error='ANALYTICS_RECOMPUTE_INTERRUPTED', updated_at=?
       WHERE type=? AND status='RUNNING' AND json_extract(payload_json,'$.storeId')=?`,
      now(),
      ANALYTICS_RECOMPUTE_JOB_TYPE,
      storeId,
    );
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

    // Cache only work completed in this captured job set, never across cycles.
    // Mutations queued while processing remain pending for the next cycle.
    const completed = new Set<string>(),
      departments = new Set<string>();
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
      notifyOutboxChanged();

      try {
        const payload = parsePayload(row.payload_json, storeId);
        const scopes = payload.scopes.filter(
          (scope) => !completed.has(scopeKey(scope)),
        );
        for (let index = 0; index < scopes.length; index += chunkSize) {
          const chunk = scopes.slice(index, index + chunkSize);
          if (this.recomputer.recomputeProducts) {
            await this.recomputer.recomputeProducts(storeId, chunk);
            for (const scope of chunk) {
              completed.add(scopeKey(scope));
              departments.delete(scope.businessDate);
              completedScopes++;
            }
          } else {
            for (const scope of chunk) {
              await this.recomputer.recomputeProduct(storeId, scope);
              completed.add(scopeKey(scope));
              departments.delete(scope.businessDate);
              completedScopes++;
            }
          }
          if (index + chunkSize < scopes.length) await yieldToInterface();
        }
        const businessDates = [
          ...new Set(payload.scopes.map((scope) => scope.businessDate)),
        ].sort();
        for (const businessDate of businessDates) {
          if (!departments.has(businessDate)) {
            await this.recomputer.recomputeDepartment(storeId, businessDate);
            departments.add(businessDate);
          }
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
        notifyOutboxChanged();
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
        notifyOutboxChanged();
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
    await this.recomputeProducts(storeId, [scope]);
  }

  async recomputeProducts(
    storeId: string,
    scopes: readonly ProductDateScope[],
  ) {
    boundedInteger(scopes.length, "batchSize", 1, 100);
    for (const scope of scopes) validateScope(scope);
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const scope of scopes)
        await this.recomputeInTransaction(transaction, storeId, scope);
    });
  }

  private async recomputeInTransaction(
    transaction: OutboxDatabase,
    storeId: string,
    scope: ProductDateScope,
  ) {
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
      const incomplete = await transaction.getAllAsync<{ source_type: string }>(
        `SELECT DISTINCT d.source_type FROM source_records r
         JOIN source_documents d ON d.id=r.source_document_id AND d.store_id=r.store_id
         WHERE r.store_id=? AND r.status='WARNING' AND r.deleted_at IS NULL
           AND json_extract(r.normalized_payload_json,'$.businessDate')=?
           AND d.deleted_at IS NULL AND d.local_processing_status='PUBLISHED'
           AND d.source_type IN ('MERCALYS_SALES','MERCALYS_WASTE')
           AND NOT EXISTS (SELECT 1 FROM sales_observations o WHERE o.source_document_id=d.id AND o.store_id=d.store_id AND o.deleted_at IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM waste_observations o WHERE o.source_document_id=d.id AND o.store_id=d.store_id AND o.deleted_at IS NOT NULL)`,
        storeId,
        businessDate,
      );
      const department = buildDepartmentDailyPerformance({
        storeId,
        businessDate,
        productPerformances: productPerformances.map((row) =>
          parseProductPerformance(row.payload_json),
        ),
        incompleteSources: {
          sales: incomplete.some((r) => r.source_type === "MERCALYS_SALES"),
          waste: incomplete.some((r) => r.source_type === "MERCALYS_WASTE"),
        },
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

function scopeKey(scope: ProductDateScope) {
  return JSON.stringify([scope.businessDate, scope.productId]);
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
