import { describe, expect, it } from "vitest";
import { productDailyGoldenFixture } from "@fl-copilot/test-fixtures";
import {
  buildProductDailyPerformance,
  serializeProductDailyPerformance,
} from "./product-daily";

describe("ProductDailyPerformance builder", () => {
  it("builds the expected product-day without mixing waste into sales", () => {
    const result = buildProductDailyPerformance(productDailyGoldenFixture);

    expect(result.sales).toEqual({
      quantity: "14.750",
      quantityUnit: "KG",
      salesValue: "60.50",
      purchaseValue: "25.00",
      marginValue: "17.00",
      marginRate: null,
    });
    expect(result.waste).toEqual({
      quantity: "0.780",
      quantityUnit: "KG",
      purchaseValueKnown: "2.50",
      purchaseValueEstimated: "0.80",
      salesValue: "5.20",
    });
    expect(result.sales.salesValue).toBe("60.50");
    expect(result.availability.salesMarginRate).toMatchObject({
      status: "UNAVAILABLE",
      reason: "AGGREGATION_NOT_VALIDATED",
    });
    expect(result.availability.salesPurchaseValue).toMatchObject({
      status: "PARTIAL",
      availableInputCount: 1,
      missingInputCount: 1,
    });
    expect(result.availability.wastePurchaseValueKnown).toMatchObject({
      status: "PARTIAL",
      availableInputCount: 1,
    });
    expect(result.availability.wastePurchaseValueEstimated).toMatchObject({
      status: "PARTIAL",
      availableInputCount: 1,
    });
  });

  it("serializes identical local and remote results from the same fixture", () => {
    const localResult = buildProductDailyPerformance(productDailyGoldenFixture);
    const remoteResult = buildProductDailyPerformance({
      ...productDailyGoldenFixture,
      salesObservations: [
        ...productDailyGoldenFixture.salesObservations,
      ].reverse(),
      wasteObservations: [
        ...productDailyGoldenFixture.wasteObservations,
      ].reverse(),
      commercialOperationIds: [
        ...productDailyGoldenFixture.commercialOperationIds,
      ].reverse(),
    });

    expect(serializeProductDailyPerformance(remoteResult)).toBe(
      serializeProductDailyPerformance(localResult),
    );
    expect(localResult.sourceLineageIds).toEqual([
      "55555555-5555-4555-8555-555555555551",
      "55555555-5555-4555-8555-555555555552",
      "77777777-7777-4777-8777-777777777771",
      "77777777-7777-4777-8777-777777777772",
    ]);
    expect(localResult.commercialOperationIds).toEqual([
      "99999999-9999-4999-8999-999999999991",
      "99999999-9999-4999-8999-999999999992",
    ]);
    expect(localResult.inputRevision).toBe(
      "product:22222222-2222-4222-8222-222222222222:1|sales:44444444-4444-4444-8444-444444444441:1|sales:44444444-4444-4444-8444-444444444442:1|waste:66666666-6666-4666-8666-666666666661:1|waste:66666666-6666-4666-8666-666666666662:1",
    );
  });

  it("preserves a single source margin rate without deriving an aggregate average", () => {
    const result = buildProductDailyPerformance({
      ...productDailyGoldenFixture,
      salesObservations: [productDailyGoldenFixture.salesObservations[0]],
    });

    expect(result.sales.marginRate).toBe("0.4048");
    expect(result.availability.salesMarginRate.status).toBe("AVAILABLE");
  });

  it("makes quantities unavailable when the product sales unit is unknown", () => {
    const result = buildProductDailyPerformance({
      ...productDailyGoldenFixture,
      product: {
        ...productDailyGoldenFixture.product,
        salesUnit: "UNKNOWN",
      },
    });

    expect(result.sales.quantity).toBeNull();
    expect(result.waste.quantity).toBeNull();
    expect(result.availability.salesQuantity.reason).toBe("UNKNOWN_UNIT");
    expect(result.sales.salesValue).toBe("60.50");
  });

  it("rejects observations outside the requested product-day perimeter", () => {
    const invalidObservation = {
      ...productDailyGoldenFixture.salesObservations[0],
      businessDate: "2026-09-25",
    };

    expect(() =>
      buildProductDailyPerformance({
        ...productDailyGoldenFixture,
        salesObservations: [invalidObservation],
      }),
    ).toThrow("outside the requested product-day perimeter");
  });

  it("ignores reconciled observations marked as deleted", () => {
    const deletedObservation = {
      ...productDailyGoldenFixture.wasteObservations[0],
      deletedAt: "2026-09-27T10:00:00.000Z",
    };
    const result = buildProductDailyPerformance({
      ...productDailyGoldenFixture,
      wasteObservations: [
        deletedObservation,
        productDailyGoldenFixture.wasteObservations[1],
      ],
    });

    expect(result.waste).toMatchObject({
      quantity: "0.20",
      purchaseValueKnown: null,
      purchaseValueEstimated: "0.80",
      salesValue: "1.20",
    });
    expect(result.sourceLineageIds).not.toContain(
      deletedObservation.sourceRecordId,
    );
  });
});
