import { describe, expect, it } from "vitest";
import { productDailyGoldenFixture } from "@fl-copilot/test-fixtures";
import {
  buildDepartmentDailyPerformance,
  serializeDepartmentDailyPerformance,
} from "./department-daily";
import { normalizeDecimal } from "./decimal";
import {
  buildProductDailyPerformance,
  type ProductDailyPerformance,
} from "./product-daily";

const STORE_ID = productDailyGoldenFixture.product.storeId;
const BUSINESS_DATE = productDailyGoldenFixture.businessDate;
const COMPUTED_AT = "2026-09-27T09:05:00.000Z";

function productPerformances() {
  const first = buildProductDailyPerformance(productDailyGoldenFixture);
  const second: ProductDailyPerformance = {
    ...first,
    productId: "88888888-8888-4888-8888-888888888888",
    sales: {
      quantity: normalizeDecimal("12"),
      quantityUnit: "PIECE" as const,
      salesValue: normalizeDecimal("39.50"),
      purchaseValue: normalizeDecimal("20.00"),
      marginValue: normalizeDecimal("13.00"),
      marginRate: normalizeDecimal("0.3291"),
    },
    waste: {
      quantity: normalizeDecimal("2"),
      quantityUnit: "PIECE" as const,
      purchaseValueKnown: normalizeDecimal("1.50"),
      purchaseValueEstimated: null,
      salesValue: normalizeDecimal("3.00"),
    },
    availability: {
      ...first.availability,
      salesQuantity: available(1),
      salesValue: available(1),
      salesPurchaseValue: available(1),
      salesMarginValue: available(1),
      salesMarginRate: available(1),
      wasteQuantity: available(1),
      wastePurchaseValueKnown: available(1),
      wastePurchaseValueEstimated: unavailable(1),
      wasteSalesValue: available(1),
    },
    sourceLineageIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    inputRevision: "product:88888888-8888-4888-8888-888888888888:1",
  };
  return [first, second] as const;
}

describe("DepartmentDailyPerformance builder", () => {
  it("qualifies each source channel without treating waste-only products as missing sales", () => {
    const sale = buildProductDailyPerformance({
      ...productDailyGoldenFixture,
      salesObservations: [productDailyGoldenFixture.salesObservations[0]],
      wasteObservations: [],
    });
    const waste = {
      ...buildProductDailyPerformance({
        ...productDailyGoldenFixture,
        salesObservations: [],
      }),
      productId: "88888888-8888-4888-8888-888888888888",
    };
    const result = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: [sale, waste],
      computedAt: COMPUTED_AT,
    });
    expect(result.sales).toMatchObject({
      salesValue: "42.00",
      marginValue: "17.00",
    });
    expect(result.waste.salesValue).toBe("5.20");
    expect(result.availability.salesValue).toMatchObject({
      status: "AVAILABLE",
      inputCount: 1,
      missingInputCount: 0,
    });
    expect(result.availability.salesMarginValue.status).toBe("AVAILABLE");
    expect(result.availability.wasteSalesValue).toMatchObject({
      status: "AVAILABLE",
      inputCount: 1,
      missingInputCount: 0,
    });
    expect(result.productCount).toBe(2);
    expect(result.sourceLineageIds).toEqual(
      [
        ...new Set([...sale.sourceLineageIds, ...waste.sourceLineageIds]),
      ].sort(),
    );
  });

  it("does not turn an absent channel into zero or hide missing values in an existing sale", () => {
    const sale = buildProductDailyPerformance({
      ...productDailyGoldenFixture,
      wasteObservations: [],
      salesObservations: productDailyGoldenFixture.salesObservations.map(
        (o, i) => ({
          ...o,
          salesValue: i === 0 ? "0" : null,
        }),
      ),
    });
    const result = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: [sale],
      computedAt: COMPUTED_AT,
    });
    expect(result.sales.salesValue).toBe("0.00");
    expect(result.availability.salesValue.status).toBe("PARTIAL");
    expect(result.waste.salesValue).toBeNull();
    expect(result.availability.wasteSalesValue).toMatchObject({
      status: "UNAVAILABLE",
      inputCount: 0,
    });
    const pending = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: [
        buildProductDailyPerformance({
          ...productDailyGoldenFixture,
          wasteObservations: [],
        }),
      ],
      computedAt: COMPUTED_AT,
      incompleteSources: { sales: true, waste: false },
    });
    expect(pending.availability.salesValue.status).toBe("PARTIAL");
  });

  it("aggregates product money values without aggregating incompatible quantities", () => {
    const result = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: productPerformances(),
      computedAt: COMPUTED_AT,
    });

    expect(result.sales).toEqual({
      salesValue: "100.00",
      purchaseValue: "45.00",
      marginValue: "30.00",
      marginRate: null,
    });
    expect(result.waste).toEqual({
      purchaseValueKnown: "4.00",
      purchaseValueEstimated: "0.80",
      salesValue: "8.20",
    });
    expect(result).not.toHaveProperty("sales.quantity");
    expect(result).not.toHaveProperty("waste.quantity");
  });

  it("never averages product or line margin rates", () => {
    const result = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: productPerformances(),
      computedAt: COMPUTED_AT,
    });

    expect(result.sales.marginRate).toBeNull();
    expect(result.availability.salesMarginRate).toMatchObject({
      status: "UNAVAILABLE",
      reason: "AGGREGATION_NOT_VALIDATED",
    });
  });

  it("propagates partial product coverage to department metrics", () => {
    const result = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: productPerformances(),
      computedAt: COMPUTED_AT,
    });

    expect(result.availability.salesValue.status).toBe("AVAILABLE");
    expect(result.availability.salesPurchaseValue.status).toBe("PARTIAL");
    expect(result.availability.salesMarginValue.status).toBe("PARTIAL");
    expect(result.availability.wastePurchaseValueKnown.status).toBe("PARTIAL");
    expect(result.availability.wastePurchaseValueEstimated.status).toBe(
      "PARTIAL",
    );
  });

  it("serializes identically regardless of product input order", () => {
    const products = productPerformances();
    const forward = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: products,
      computedAt: COMPUTED_AT,
    });
    const reversed = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: [...products].reverse(),
      computedAt: COMPUTED_AT,
    });

    expect(serializeDepartmentDailyPerformance(reversed)).toBe(
      serializeDepartmentDailyPerformance(forward),
    );
    expect(forward.productCount).toBe(2);
  });

  it("returns unavailable rather than zero for an empty department day", () => {
    const result = buildDepartmentDailyPerformance({
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: [],
      computedAt: COMPUTED_AT,
    });

    expect(result.sales.salesValue).toBeNull();
    expect(result.waste.purchaseValueKnown).toBeNull();
    expect(result.availability.salesValue).toMatchObject({
      status: "UNAVAILABLE",
      reason: "MISSING_INPUT",
    });
    expect(result.productCount).toBe(0);
  });

  it("rejects duplicate products and mismatched perimeters", () => {
    const [first] = productPerformances();
    expect(() =>
      buildDepartmentDailyPerformance({
        storeId: STORE_ID,
        businessDate: BUSINESS_DATE,
        productPerformances: [first, first],
        computedAt: COMPUTED_AT,
      }),
    ).toThrow("Duplicate product performance");

    expect(() =>
      buildDepartmentDailyPerformance({
        storeId: STORE_ID,
        businessDate: "2026-09-25",
        productPerformances: [first],
        computedAt: COMPUTED_AT,
      }),
    ).toThrow("outside the requested department-day perimeter");
  });
});

function available(inputCount: number) {
  return {
    status: "AVAILABLE" as const,
    inputCount,
    availableInputCount: inputCount,
    missingInputCount: 0,
  };
}

function unavailable(inputCount: number) {
  return {
    status: "UNAVAILABLE" as const,
    inputCount,
    availableInputCount: 0,
    missingInputCount: inputCount,
    reason: "MISSING_INPUT" as const,
  };
}

it.each([
  { sales: true, waste: false },
  { sales: false, waste: true },
  { sales: true, waste: true },
])(
  "qualifies only the incomplete source channel without changing known totals or converting missing into zero (%o)",
  (incompleteSources) => {
    const input = {
      storeId: STORE_ID,
      businessDate: BUSINESS_DATE,
      productPerformances: productPerformances(),
      computedAt: COMPUTED_AT,
    };
    const baseline = buildDepartmentDailyPerformance(input);
    const partial = buildDepartmentDailyPerformance({
      ...input,
      incompleteSources,
    });
    expect(partial.sales).toEqual(baseline.sales);
    expect(partial.waste).toEqual(baseline.waste);
    expect(partial.availability.salesValue.status).toBe(
      incompleteSources.sales ? "PARTIAL" : "AVAILABLE",
    );
    expect(partial.availability.wasteSalesValue.status).toBe(
      incompleteSources.waste ? "PARTIAL" : "AVAILABLE",
    );
    expect(partial.inputRevision).not.toBe(baseline.inputRevision);
    const empty = buildDepartmentDailyPerformance({
      ...input,
      productPerformances: [],
      incompleteSources,
    });
    expect(empty.sales.salesValue).toBeNull();
    expect(empty.waste.salesValue).toBeNull();
    expect(empty.availability.salesValue.status).toBe("UNAVAILABLE");
    expect(empty.availability.wasteSalesValue.status).toBe("UNAVAILABLE");
  },
);
