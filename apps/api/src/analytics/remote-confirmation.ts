import {
  buildDepartmentDailyPerformance,
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
    const normalized = normalizeScopes(scopes);
    if (normalized.length === 0) {
      throw new Error("At least one product/date scope is required.");
    }

    const products: ProductDailyPerformance[] = [];
    for (const scope of normalized) {
      const input = await this.repository.loadProductDay(storeId, scope);
      const performance = buildProductDailyPerformance({
        ...input,
        businessDate: scope.businessDate,
        computedAt: this.now(),
      });
      await this.repository.saveProductDay(performance);
      products.push(performance);
    }

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
        computedAt: this.now(),
      });
      await this.repository.saveDepartmentDay(department);
      departments.push(department);
    }

    return { products, departments };
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
  return {
    async loadProductDay(storeId, scope) {
      const db = await database.getDb();
      const product = await db.collection<ProductDocument>("products").findOne({
        _id: scope.productId,
        storeId,
        deletedAt: null,
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
          })
          .sort({ _id: 1 })
          .toArray(),
      ]);
      return {
        product: mapProduct(product),
        salesObservations: sales.map(mapSalesObservation),
        wasteObservations: waste.map(mapWasteObservation),
        commercialOperationIds: [],
        merchandisingPlanIds: [],
        contextEventIds: [],
        marketSignalIds: [],
        storeProductEventIds: [],
        weatherRecordId: null,
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
      await db
        .collection<ProductDailyPerformanceDocument>("productDailyPerformance")
        .replaceOne({ _id: document._id }, document, { upsert: true });
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
