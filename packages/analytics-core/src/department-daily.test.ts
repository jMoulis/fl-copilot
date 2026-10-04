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
