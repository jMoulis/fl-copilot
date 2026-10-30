import {
  buildDepartmentDailyPerformance,
  DEPARTMENT_COVERAGE_REVISION,
  buildProductDailyPerformance,
  type DepartmentDailyPerformance,
  type ProductDailyPerformanceInput,
  type ProductDailyPerformance,
  type ProductDailySalesObservation,
  type ProductDailyWasteObservation,
} from "@fl-copilot/analytics-core";
import type { Product } from "@fl-copilot/domain";
import { Decimal128 } from "mongodb";
import type { DatabaseService } from "../database/types.js";

export interface RemoteProductDateScope {
  readonly productId: string;
  readonly businessDate: string;
}

export type RemoteProductDayInput = Omit<
  ProductDailyPerformanceInput,
  "businessDate" | "computedAt"
>;

export interface RemoteAnalyticsRepository {
  loadProductDay(
    storeId: string,
    scope: RemoteProductDateScope,
  ): Promise<RemoteProductDayInput>;
  saveProductDay(performance: ProductDailyPerformance): Promise<void>;
  loadProductDays(
    storeId: string,
    businessDate: string,
  ): Promise<readonly ProductDailyPerformance[]>;
  loadDepartmentSourceCompleteness(
    storeId: string,
    businessDate: string,
  ): Promise<{ sales: boolean; waste: boolean }>;
  saveDepartmentDay(performance: DepartmentDailyPerformance): Promise<void>;
}

export interface RemoteAnalyticsConfirmation {
  readonly products: readonly ProductDailyPerformance[];
  readonly departments: readonly DepartmentDailyPerformance[];
}

export class RemoteAnalyticsConfirmationService {
  constructor(
    private readonly repository: RemoteAnalyticsRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async confirm(
    storeId: string,
    scopes: readonly RemoteProductDateScope[],
  ): Promise<RemoteAnalyticsConfirmation> {
    const products = await this.confirmProducts(storeId, scopes);
    const normalized = normalizeScopes(scopes);

    const departments: DepartmentDailyPerformance[] = [];
    const dates = [...new Set(normalized.map((scope) => scope.businessDate))];
    for (const businessDate of dates) {
      const productPerformances = await this.repository.loadProductDays(
        storeId,
        businessDate,
      );
      const department = buildDepartmentDailyPerformance({
        storeId,
        businessDate,
        productPerformances,
        incompleteSources:
          await this.repository.loadDepartmentSourceCompleteness(
            storeId,
            businessDate,
          ),
        computedAt: this.now(),
      });
      await this.repository.saveDepartmentDay(department);
      departments.push(department);
    }

    return { products, departments };
  }

  /** Unit corrections change product quantities/prices, never department money. */
  async confirmProducts(
    storeId: string,
    scopes: readonly RemoteProductDateScope[],
  ) {
    const normalized = normalizeScopes(scopes);
    if (normalized.length === 0) {
      throw new Error("At least one product/date scope is required.");
    }

    const products: ProductDailyPerformance[] = [];
    // Independent product/date computations are bounded; aggregate the department only after every save.
    for (let offset = 0; offset < normalized.length; offset += 8) {
      const results = await Promise.allSettled(
        normalized.slice(offset, offset + 8).map(async (scope) => {
          const input = await this.repository.loadProductDay(storeId, scope);
          const performance = buildProductDailyPerformance({
            ...input,
            businessDate: scope.businessDate,
            computedAt: this.now(),
          });
          await this.repository.saveProductDay(performance);
          return performance;
        }),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      for (const result of results)
        if (result.status === "fulfilled") products.push(result.value);
    }

    return products;
  }
}

interface ProductDocument {
  readonly _id: string;
  readonly storeId: string;
  readonly label: string;
  readonly category: Product["category"];
  readonly nature: Product["nature"];
  readonly salesUnit: Product["salesUnit"];
  readonly packaging?: {
    readonly quantity: Decimal128;
    readonly unit: NonNullable<Product["packaging"]>["unit"];
    readonly sourceLabel?: string | null;
  } | null;
  readonly familyId?: string | null;
  readonly subfamilyId?: string | null;
  readonly status: Product["status"];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt?: Date | null;
}

interface SalesObservationDocument {
  readonly _id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly date: string;
  readonly quantity: Decimal128;
  readonly purchaseValue?: Decimal128 | null;
  readonly salesValue?: Decimal128 | null;
  readonly marginValue?: Decimal128 | null;
  readonly marginRate?: Decimal128 | null;
  readonly sourceRecordId: string;
  readonly validationStatus: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly deletedAt?: Date | null;
}

interface WasteObservationDocument {
  readonly _id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly date: string;
  readonly quantity?: Decimal128 | null;
  readonly purchaseValueKnown?: Decimal128 | null;
  readonly purchaseValueEstimated?: Decimal128 | null;
  readonly salesValue?: Decimal128 | null;
  readonly costQuality: ProductDailyWasteObservation["costQuality"];
  readonly sourceRecordId: string;
  readonly validationStatus: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly deletedAt?: Date | null;
}

interface ProductDailyPerformanceDocument {
  readonly _id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly date: string;
  readonly performance: ProductDailyPerformance;
  readonly origin: "REMOTE";
  readonly formulaVersion: string;
  readonly inputRevision: string;
  readonly computedAt: Date;
}

interface DepartmentDailyPerformanceDocument {
  readonly _id: string;
  readonly storeId: string;
  readonly date: string;
  readonly performance: DepartmentDailyPerformance;
  readonly origin: "REMOTE";
  readonly formulaVersion: string;
  readonly inputRevision: string;
  readonly computedAt: Date;
}

export function createMongoRemoteAnalyticsRepository(
  database: DatabaseService,
): RemoteAnalyticsRepository {
  const expectedSnapshots = new Map<
    string,
    ProductDailyPerformanceDocument | null
  >();
  return {
    async loadProductDay(storeId, scope) {
      const db = await database.getDb();
      const previous = await db
        .collection<ProductDailyPerformanceDocument>("productDailyPerformance")
        .findOne({
          _id: productDayId(storeId, scope.productId, scope.businessDate),
          storeId,
        });
      expectedSnapshots.set(
        productDayId(storeId, scope.productId, scope.businessDate),
        previous,
      );
      const product = await db.collection<ProductDocument>("products").findOne({
        _id: scope.productId,
        storeId,
      });
      if (!product) {
        throw new Error(
          `Product ${scope.productId} is unavailable for remote confirmation.`,
        );
      }
      const [sales, waste] = await Promise.all([
        db
          .collection<SalesObservationDocument>("salesObservations")
          .find({
            storeId,
            productId: scope.productId,
            date: scope.businessDate,
            validationStatus: "VALIDATED",
            deletedAt: null,
          })
          .sort({ _id: 1 })
          .toArray(),
        db
          .collection<WasteObservationDocument>("wasteObservations")
          .find({
            storeId,
            productId: scope.productId,
            date: scope.businessDate,
            validationStatus: "VALIDATED",
            deletedAt: null,
          })
          .sort({ _id: 1 })
          .toArray(),
      ]);
      return {
        product: mapProduct(product),
        salesObservations: sales.map(mapSalesObservation),
        wasteObservations: waste.map(mapWasteObservation),
        commercialOperationIds:
          previous?.performance.commercialOperationIds ?? [],
        merchandisingPlanIds: previous?.performance.merchandisingPlanIds ?? [],
        contextEventIds: previous?.performance.contextEventIds ?? [],
        marketSignalIds: previous?.performance.marketSignalIds ?? [],
        storeProductEventIds: previous?.performance.storeProductEventIds ?? [],
        weatherRecordId: previous?.performance.weatherRecordId ?? null,
      };
    },

    async saveProductDay(performance) {
      const db = await database.getDb();
      const document: ProductDailyPerformanceDocument = {
        _id: productDayId(
          performance.storeId,
          performance.productId,
          performance.date,
        ),
        storeId: performance.storeId,
        productId: performance.productId,
        date: performance.date,
        performance,
        origin: "REMOTE",
        formulaVersion: performance.formulaVersion,
        inputRevision: performance.inputRevision,
        computedAt: new Date(performance.computedAt),
      };
      const key = document._id;
      if (!expectedSnapshots.has(key))
        throw Error("REMOTE_ANALYTICS_INPUT_REQUIRED");
      const previous = expectedSnapshots.get(key);
      const collection = db.collection<ProductDailyPerformanceDocument>(
        "productDailyPerformance",
      );
      if (!previous) {
        await collection.insertOne(document);
      } else {
        const result = await collection.replaceOne(
          {
            _id: key,
            storeId: performance.storeId,
            inputRevision: previous.inputRevision,
            computedAt: previous.computedAt,
          },
          document,
        );
        if (result.matchedCount !== 1)
          throw Error("REMOTE_ANALYTICS_SNAPSHOT_CHANGED");
      }
      expectedSnapshots.set(key, document);
    },

    async loadProductDays(storeId, businessDate) {
      const db = await database.getDb();
      const documents = await db
        .collection<ProductDailyPerformanceDocument>("productDailyPerformance")
        .find({ storeId, date: businessDate })
        .sort({ productId: 1 })
        .toArray();
      return documents.map((document) => document.performance);
    },

    async loadDepartmentSourceCompleteness(storeId, businessDate) {
      const db = await database.getDb();
      const pending = (sourceType: "MERCALYS_SALES" | "MERCALYS_WASTE") =>
        db.collection("mercalysPublications").findOne(
          {
            storeId,
            "publication.source.sourceType": sourceType,
            "publication.source.deletedAt": null,
            "publication.records": {
              $elemMatch: {
                status: "WARNING",
                deletedAt: null,
                "normalizedPayload.businessDate": businessDate,
              },
            },
            // A superseded source cannot block the completeness of its replacement.
            "publication.sales": {
              $not: { $elemMatch: { deletedAt: { $ne: null } } },
            },
            "publication.waste": {
              $not: { $elemMatch: { deletedAt: { $ne: null } } },
            },
          },
          { projection: { _id: 1 }, maxTimeMS: 5000 },
        );
      const [sales, waste] = await Promise.all([
        pending("MERCALYS_SALES"),
        pending("MERCALYS_WASTE"),
      ]);
      return { sales: !!sales, waste: !!waste };
    },

    async saveDepartmentDay(performance) {
      const db = await database.getDb();
      const document: DepartmentDailyPerformanceDocument = {
        _id: departmentDayId(performance.storeId, performance.date),
        storeId: performance.storeId,
        date: performance.date,
        performance,
        origin: "REMOTE",
        formulaVersion: performance.formulaVersion,
        inputRevision: performance.inputRevision,
        computedAt: new Date(performance.computedAt),
      };
      await db
        .collection<DepartmentDailyPerformanceDocument>(
          "departmentDailyPerformance",
        )
        .replaceOne({ _id: document._id }, document, { upsert: true });
    },
  };
}

export function createMongoRemoteAnalyticsConfirmationService(
  database: DatabaseService,
  now?: () => string,
) {
  return new RemoteAnalyticsConfirmationService(
    createMongoRemoteAnalyticsRepository(database),
    now,
  );
}

/** Opportunistic derived-cache upgrade during the existing sync maintenance.
 * Bound each pass; never republish sources or replace a concurrently refreshed row. */
export async function refreshDepartmentCoverage(
  database: DatabaseService,
  storeId?: string,
  now: () => Date = () => new Date(),
) {
  const db = await database.getDb();
  const collection = db.collection<DepartmentDailyPerformanceDocument>(
    "departmentDailyPerformance",
  );
  const prefix = new RegExp(
    `^${DEPARTMENT_COVERAGE_REVISION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  const rows = await collection
    .find({
      ...(storeId ? { storeId } : {}),
      inputRevision: { $not: prefix },
    })
    .sort({ date: -1, _id: 1 })
    .limit(16)
    .toArray();
  const repository = createMongoRemoteAnalyticsRepository(database);
  const deadline = Date.now() + 1_000;
  let refreshed = 0,
    examined = 0;
  for (const row of rows) {
    if (examined++ && Date.now() >= deadline) break;
    const productPerformances = await repository.loadProductDays(
      row.storeId,
      row.date,
    );
    // A bootstrap may have only the department cache. Keep it until its inputs exist.
    if (productPerformances.length < row.performance.productCount) continue;
    const performance = buildDepartmentDailyPerformance({
      storeId: row.storeId,
      businessDate: row.date,
      productPerformances,
      incompleteSources: await repository.loadDepartmentSourceCompleteness(
        row.storeId,
        row.date,
      ),
      computedAt: now().toISOString(),
    });
    const result = await collection.updateOne(
      {
        _id: row._id,
        storeId: row.storeId,
        inputRevision: row.inputRevision,
      },
      {
        $set: {
          performance,
          inputRevision: performance.inputRevision,
          computedAt: new Date(performance.computedAt),
        },
      },
    );
    refreshed += result.modifiedCount;
  }
  return refreshed;
}

function mapProduct(document: ProductDocument): Product {
  return {
    id: document._id,
    storeId: document.storeId,
    label: document.label,
    category: document.category,
    nature: document.nature,
    salesUnit: document.salesUnit,
    packaging: document.packaging
      ? {
          quantity: document.packaging.quantity.toString(),
          unit: document.packaging.unit,
          sourceLabel: document.packaging.sourceLabel ?? null,
        }
      : null,
    familyId: document.familyId ?? null,
    subfamilyId: document.subfamilyId ?? null,
    status: document.status,
    version: document.version,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  };
}

function mapSalesObservation(
  document: SalesObservationDocument,
): ProductDailySalesObservation {
  return {
    id: document._id,
    storeId: document.storeId,
    productId: document.productId,
    businessDate: document.date,
    quantity: document.quantity.toString(),
    purchaseValue: decimalString(document.purchaseValue),
    salesValue: decimalString(document.salesValue),
    marginValue: decimalString(document.marginValue),
    marginRate: decimalString(document.marginRate),
    sourceRecordId: document.sourceRecordId,
    validationStatus: assertValidated(document.validationStatus, document._id),
    version: document.version,
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  };
}

function mapWasteObservation(
  document: WasteObservationDocument,
): ProductDailyWasteObservation {
  return {
    id: document._id,
    storeId: document.storeId,
    productId: document.productId,
    businessDate: document.date,
    quantity: decimalString(document.quantity),
    purchaseValueKnown: decimalString(document.purchaseValueKnown),
    purchaseValueEstimated: decimalString(document.purchaseValueEstimated),
    salesValue: decimalString(document.salesValue),
    costQuality: document.costQuality,
    sourceRecordId: document.sourceRecordId,
    validationStatus: assertValidated(document.validationStatus, document._id),
    version: document.version,
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  };
}

function decimalString(value: Decimal128 | null | undefined) {
  return value?.toString() ?? null;
}

function assertValidated(status: string, id: string): "VALIDATED" {
  if (status !== "VALIDATED") {
    throw new Error(`Observation ${id} is not validated.`);
  }
  return status;
}

function normalizeScopes(scopes: readonly RemoteProductDateScope[]) {
  const normalized = new Map<string, RemoteProductDateScope>();
  for (const scope of scopes) {
    if (!scope.productId || !/^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate)) {
      throw new Error("Invalid remote analytics scope.");
    }
    normalized.set(`${scope.productId}:${scope.businessDate}`, scope);
  }
  return [...normalized.values()].sort(
    (left, right) =>
      left.businessDate.localeCompare(right.businessDate) ||
      left.productId.localeCompare(right.productId),
  );
}

function productDayId(storeId: string, productId: string, date: string) {
  return `product-day:${storeId}:${productId}:${date}`;
}

function departmentDayId(storeId: string, date: string) {
  return `department-day:${storeId}:${date}`;
}
