import { sumAvailableCurrency, type DecimalFormulaResult } from "./formulas";
import type { DecimalString } from "./decimal";
import type {
  MetricAvailability,
  ProductDailyPerformance,
} from "./product-daily";

export const DEPARTMENT_DAILY_FORMULA_VERSION = "department-daily-v1";

export interface DepartmentDailyPerformanceInput {
  readonly storeId: string;
  readonly businessDate: string;
  readonly productPerformances: readonly ProductDailyPerformance[];
  readonly computedAt: string;
}

export interface DepartmentDailyPerformance {
  readonly storeId: string;
  readonly date: string;
  readonly sales: {
    readonly salesValue: DecimalString | null;
    readonly purchaseValue: DecimalString | null;
    readonly marginValue: DecimalString | null;
    readonly marginRate: null;
  };
  readonly waste: {
    readonly purchaseValueKnown: DecimalString | null;
    readonly purchaseValueEstimated: DecimalString | null;
    readonly salesValue: DecimalString | null;
  };
  readonly availability: {
    readonly salesValue: MetricAvailability;
    readonly salesPurchaseValue: MetricAvailability;
    readonly salesMarginValue: MetricAvailability;
    readonly salesMarginRate: MetricAvailability;
    readonly wastePurchaseValueKnown: MetricAvailability;
    readonly wastePurchaseValueEstimated: MetricAvailability;
    readonly wasteSalesValue: MetricAvailability;
  };
  readonly productCount: number;
  readonly sourceLineageIds: readonly string[];
  readonly inputRevision: string;
  readonly formulaVersion: typeof DEPARTMENT_DAILY_FORMULA_VERSION;
  readonly computedAt: string;
}

export function buildDepartmentDailyPerformance(
  input: DepartmentDailyPerformanceInput,
): DepartmentDailyPerformance {
  validateProductPerformances(input);

  const salesValue = aggregateCurrencyMetric(
    input.productPerformances,
    (performance) => performance.sales.salesValue,
    (performance) => performance.availability.salesValue,
  );
  const salesPurchaseValue = aggregateCurrencyMetric(
    input.productPerformances,
    (performance) => performance.sales.purchaseValue,
    (performance) => performance.availability.salesPurchaseValue,
  );
  const salesMarginValue = aggregateCurrencyMetric(
    input.productPerformances,
    (performance) => performance.sales.marginValue,
    (performance) => performance.availability.salesMarginValue,
  );
  const wastePurchaseValueKnown = aggregateCurrencyMetric(
    input.productPerformances,
    (performance) => performance.waste.purchaseValueKnown,
    (performance) => performance.availability.wastePurchaseValueKnown,
  );
  const wastePurchaseValueEstimated = aggregateCurrencyMetric(
    input.productPerformances,
    (performance) => performance.waste.purchaseValueEstimated,
    (performance) => performance.availability.wastePurchaseValueEstimated,
  );
  const wasteSalesValue = aggregateCurrencyMetric(
    input.productPerformances,
    (performance) => performance.waste.salesValue,
    (performance) => performance.availability.wasteSalesValue,
  );

  return {
    storeId: input.storeId,
    date: input.businessDate,
    sales: {
      salesValue: salesValue.value,
      purchaseValue: salesPurchaseValue.value,
      marginValue: salesMarginValue.value,
      marginRate: null,
    },
    waste: {
      purchaseValueKnown: wastePurchaseValueKnown.value,
      purchaseValueEstimated: wastePurchaseValueEstimated.value,
      salesValue: wasteSalesValue.value,
    },
    availability: {
      salesValue: availabilityOf(salesValue),
      salesPurchaseValue: availabilityOf(salesPurchaseValue),
      salesMarginValue: availabilityOf(salesMarginValue),
      salesMarginRate: unavailableMarginRate(input.productPerformances),
      wastePurchaseValueKnown: availabilityOf(wastePurchaseValueKnown),
      wastePurchaseValueEstimated: availabilityOf(wastePurchaseValueEstimated),
      wasteSalesValue: availabilityOf(wasteSalesValue),
    },
    productCount: input.productPerformances.length,
    sourceLineageIds: sortedUnique(
      input.productPerformances.flatMap(
        (performance) => performance.sourceLineageIds,
      ),
    ),
    inputRevision: buildInputRevision(input.productPerformances),
    formulaVersion: DEPARTMENT_DAILY_FORMULA_VERSION,
    computedAt: input.computedAt,
  };
}

export function serializeDepartmentDailyPerformance(
  performance: DepartmentDailyPerformance,
): string {
  return JSON.stringify(performance);
}

function aggregateCurrencyMetric(
  performances: readonly ProductDailyPerformance[],
  selectValue: (performance: ProductDailyPerformance) => string | null,
  selectAvailability: (
    performance: ProductDailyPerformance,
  ) => MetricAvailability,
): DecimalFormulaResult {
  const result = sumAvailableCurrency(performances.map(selectValue));
  if (
    result.status !== "UNAVAILABLE" &&
    performances.some(
      (performance) => selectAvailability(performance).status !== "AVAILABLE",
    )
  ) {
    return { ...result, status: "PARTIAL" };
  }
  return result;
}

function availabilityOf(result: DecimalFormulaResult): MetricAvailability {
  return {
    status: result.status,
    inputCount: result.inputCount,
    availableInputCount: result.availableInputCount,
    missingInputCount: result.missingInputCount,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

function unavailableMarginRate(
  performances: readonly ProductDailyPerformance[],
): MetricAvailability {
  const availableInputCount = performances.filter(
    (performance) => performance.sales.marginRate !== null,
  ).length;
  return {
    status: "UNAVAILABLE",
    inputCount: performances.length,
    availableInputCount,
    missingInputCount: performances.length - availableInputCount,
    reason:
      performances.length === 0 ? "MISSING_INPUT" : "AGGREGATION_NOT_VALIDATED",
  };
}

function validateProductPerformances(input: DepartmentDailyPerformanceInput) {
  const productIds = new Set<string>();
  for (const performance of input.productPerformances) {
    if (
      performance.storeId !== input.storeId ||
      performance.date !== input.businessDate
    ) {
      throw new Error(
        `Product performance ${performance.productId} is outside the requested department-day perimeter.`,
      );
    }
    if (productIds.has(performance.productId)) {
      throw new Error(
        `Duplicate product performance for product ${performance.productId}.`,
      );
    }
    productIds.add(performance.productId);
  }
}

function buildInputRevision(
  performances: readonly ProductDailyPerformance[],
): string {
  return performances
    .map(
      (performance) =>
        `product-daily:${performance.productId}:${performance.inputRevision}`,
    )
    .sort()
    .join("|");
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
