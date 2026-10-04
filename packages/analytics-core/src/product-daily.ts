import type {
  Product,
  SalesObservation,
  WasteObservation,
} from "@fl-copilot/domain";
import {
  sumAvailableCurrency,
  sumCompatibleQuantities,
  type DecimalFormulaResult,
  type FormulaStatus,
  type FormulaUnavailableReason,
  type QuantityFormulaResult,
  type SalesUnit,
} from "./formulas";
import type { DecimalString } from "./decimal";

export const PRODUCT_DAILY_FORMULA_VERSION = "product-daily-v1";

export type ProductDailySalesObservation = Pick<
  SalesObservation,
  | "id"
  | "storeId"
  | "productId"
  | "businessDate"
  | "quantity"
  | "purchaseValue"
  | "salesValue"
  | "marginValue"
  | "marginRate"
  | "sourceRecordId"
  | "validationStatus"
  | "version"
  | "updatedAt"
  | "deletedAt"
>;

export type ProductDailyWasteObservation = Pick<
  WasteObservation,
  | "id"
  | "storeId"
  | "productId"
  | "businessDate"
  | "quantity"
  | "purchaseValueKnown"
  | "purchaseValueEstimated"
  | "salesValue"
  | "costQuality"
  | "sourceRecordId"
  | "validationStatus"
  | "version"
  | "updatedAt"
  | "deletedAt"
>;

export interface ProductDailyPerformanceInput {
  readonly product: Product;
  readonly businessDate: string;
  readonly salesObservations: readonly ProductDailySalesObservation[];
  readonly wasteObservations: readonly ProductDailyWasteObservation[];
  readonly commercialOperationIds?: readonly string[];
  readonly merchandisingPlanIds?: readonly string[];
  readonly contextEventIds?: readonly string[];
  readonly marketSignalIds?: readonly string[];
  readonly storeProductEventIds?: readonly string[];
  readonly weatherRecordId?: string | null;
  readonly computedAt: string;
}

export interface MetricAvailability {
  readonly status: FormulaStatus;
  readonly inputCount: number;
  readonly availableInputCount: number;
  readonly missingInputCount: number;
  readonly reason?: FormulaUnavailableReason | "AGGREGATION_NOT_VALIDATED";
}

export interface ProductDailyPerformance {
  readonly storeId: string;
  readonly productId: string;
  readonly date: string;
  readonly sales: {
    readonly quantity: DecimalString | null;
    readonly quantityUnit: Exclude<SalesUnit, "UNKNOWN"> | null;
    readonly salesValue: DecimalString | null;
    readonly purchaseValue: DecimalString | null;
    readonly marginValue: DecimalString | null;
    readonly marginRate: DecimalString | null;
  };
  readonly waste: {
    readonly quantity: DecimalString | null;
    readonly quantityUnit: Exclude<SalesUnit, "UNKNOWN"> | null;
    readonly purchaseValueKnown: DecimalString | null;
    readonly purchaseValueEstimated: DecimalString | null;
    readonly salesValue: DecimalString | null;
  };
  readonly availability: {
    readonly salesQuantity: MetricAvailability;
    readonly salesValue: MetricAvailability;
    readonly salesPurchaseValue: MetricAvailability;
    readonly salesMarginValue: MetricAvailability;
    readonly salesMarginRate: MetricAvailability;
    readonly wasteQuantity: MetricAvailability;
    readonly wastePurchaseValueKnown: MetricAvailability;
    readonly wastePurchaseValueEstimated: MetricAvailability;
    readonly wasteSalesValue: MetricAvailability;
  };
  readonly commercialOperationIds: readonly string[];
  readonly merchandisingPlanIds: readonly string[];
  readonly contextEventIds: readonly string[];
  readonly marketSignalIds: readonly string[];
  readonly storeProductEventIds: readonly string[];
  readonly weatherRecordId: string | null;
  readonly sourceLineageIds: readonly string[];
  readonly inputRevision: string;
  readonly formulaVersion: typeof PRODUCT_DAILY_FORMULA_VERSION;
  readonly computedAt: string;
}

export function buildProductDailyPerformance(
  input: ProductDailyPerformanceInput,
): ProductDailyPerformance {
  const sales = activeSalesObservations(input);
  const waste = activeWasteObservations(input);
  const salesQuantity = sumCompatibleQuantities(
    sales.map((observation) => ({
      value: observation.quantity,
      unit: input.product.salesUnit,
    })),
  );
  const wasteQuantity = sumCompatibleQuantities(
    waste.map((observation) => ({
      value: observation.quantity,
      unit: input.product.salesUnit,
    })),
  );
  const salesValue = sumAvailableCurrency(
    sales.map((observation) => observation.salesValue),
  );
  const salesPurchaseValue = sumAvailableCurrency(
    sales.map((observation) => observation.purchaseValue),
  );
  const salesMarginValue = sumAvailableCurrency(
    sales.map((observation) => observation.marginValue),
  );
  const salesMarginRate = sourceMarginRate(sales);
  const wastePurchaseValueKnown = sumAvailableCurrency(
    waste.map((observation) =>
      observation.costQuality === "KNOWN"
        ? observation.purchaseValueKnown
        : null,
    ),
  );
  const wastePurchaseValueEstimated = sumAvailableCurrency(
    waste.map((observation) =>
      observation.costQuality === "ESTIMATED"
        ? observation.purchaseValueEstimated
        : null,
    ),
  );
  const wasteSalesValue = sumAvailableCurrency(
    waste.map((observation) => observation.salesValue),
  );

  return {
    storeId: input.product.storeId,
    productId: input.product.id,
    date: input.businessDate,
    sales: {
      quantity: salesQuantity.value,
      quantityUnit: salesQuantity.unit,
      salesValue: salesValue.value,
      purchaseValue: salesPurchaseValue.value,
      marginValue: salesMarginValue.value,
      marginRate: salesMarginRate.value,
    },
    waste: {
      quantity: wasteQuantity.value,
      quantityUnit: wasteQuantity.unit,
      purchaseValueKnown: wastePurchaseValueKnown.value,
      purchaseValueEstimated: wastePurchaseValueEstimated.value,
      salesValue: wasteSalesValue.value,
    },
    availability: {
      salesQuantity: availabilityOf(salesQuantity),
      salesValue: availabilityOf(salesValue),
      salesPurchaseValue: availabilityOf(salesPurchaseValue),
      salesMarginValue: availabilityOf(salesMarginValue),
      salesMarginRate: availabilityOf(salesMarginRate),
      wasteQuantity: availabilityOf(wasteQuantity),
      wastePurchaseValueKnown: availabilityOf(wastePurchaseValueKnown),
      wastePurchaseValueEstimated: availabilityOf(wastePurchaseValueEstimated),
      wasteSalesValue: availabilityOf(wasteSalesValue),
    },
    commercialOperationIds: sortedUnique(input.commercialOperationIds),
    merchandisingPlanIds: sortedUnique(input.merchandisingPlanIds),
    contextEventIds: sortedUnique(input.contextEventIds),
    marketSignalIds: sortedUnique(input.marketSignalIds),
    storeProductEventIds: sortedUnique(input.storeProductEventIds),
    weatherRecordId: input.weatherRecordId ?? null,
    sourceLineageIds: sortedUnique([
      ...sales.map((observation) => observation.sourceRecordId),
      ...waste.map((observation) => observation.sourceRecordId),
    ]),
    inputRevision: buildInputRevision(input.product, sales, waste),
    formulaVersion: PRODUCT_DAILY_FORMULA_VERSION,
    computedAt: input.computedAt,
  };
}

export function serializeProductDailyPerformance(
  performance: ProductDailyPerformance,
): string {
  return JSON.stringify(performance);
}

function activeSalesObservations(
  input: ProductDailyPerformanceInput,
): readonly ProductDailySalesObservation[] {
  validatePerimeter(input.product, input.businessDate, input.salesObservations);
  return input.salesObservations.filter(
    (observation) => observation.deletedAt === null,
  );
}

function activeWasteObservations(
  input: ProductDailyPerformanceInput,
): readonly ProductDailyWasteObservation[] {
  validatePerimeter(input.product, input.businessDate, input.wasteObservations);
  return input.wasteObservations.filter(
    (observation) => observation.deletedAt === null,
  );
}

function validatePerimeter(
  product: Product,
  businessDate: string,
  observations: readonly (
    ProductDailySalesObservation | ProductDailyWasteObservation
  )[],
) {
  for (const observation of observations) {
    if (
      observation.storeId !== product.storeId ||
      observation.productId !== product.id ||
      observation.businessDate !== businessDate
    ) {
      throw new Error(
        `Observation ${observation.id} is outside the requested product-day perimeter.`,
      );
    }
    if (observation.validationStatus !== "VALIDATED") {
      throw new Error(`Observation ${observation.id} is not validated.`);
    }
  }
}

type BuilderFormulaResult = Omit<DecimalFormulaResult, "reason"> & {
  readonly reason?: FormulaUnavailableReason | "AGGREGATION_NOT_VALIDATED";
};

function sourceMarginRate(
  observations: readonly ProductDailySalesObservation[],
): BuilderFormulaResult {
  if (observations.length !== 1) {
    return {
      value: null,
      status: "UNAVAILABLE",
      inputCount: observations.length,
      availableInputCount: observations.filter(
        (observation) => observation.marginRate !== null,
      ).length,
      missingInputCount: observations.filter(
        (observation) => observation.marginRate === null,
      ).length,
      reason:
        observations.length === 0
          ? "MISSING_INPUT"
          : "AGGREGATION_NOT_VALIDATED",
    };
  }

  const marginRate = observations[0]?.marginRate;
  return marginRate === null || marginRate === undefined
    ? {
        value: null,
        status: "UNAVAILABLE",
        inputCount: 1,
        availableInputCount: 0,
        missingInputCount: 1,
        reason: "MISSING_INPUT",
      }
    : {
        value: marginRate as DecimalString,
        status: "AVAILABLE",
        inputCount: 1,
        availableInputCount: 1,
        missingInputCount: 0,
      };
}

function availabilityOf(
  result: DecimalFormulaResult | QuantityFormulaResult | BuilderFormulaResult,
): MetricAvailability {
  return {
    status: result.status,
    inputCount: result.inputCount,
    availableInputCount: result.availableInputCount,
    missingInputCount: result.missingInputCount,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

function sortedUnique(
  values: readonly string[] | undefined,
): readonly string[] {
  return [...new Set(values ?? [])].sort();
}

function buildInputRevision(
  product: Product,
  sales: readonly ProductDailySalesObservation[],
  waste: readonly ProductDailyWasteObservation[],
): string {
  return [
    `product:${product.id}:${product.version}`,
    ...sales.map(
      (observation) => `sales:${observation.id}:${observation.version}`,
    ),
    ...waste.map(
      (observation) => `waste:${observation.id}:${observation.version}`,
    ),
  ]
    .sort()
    .join("|");
}
