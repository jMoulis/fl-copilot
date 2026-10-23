import { expect, it } from "vitest";
import { calculateSalesMeasures } from "./sales-measures";
const period = { start: "2025-10-01", end: "2025-10-02" };
const point = (
  date: string,
  sales: string | null,
  quantity: string | null,
  unit: "KG" | "PIECE" | "PACK" | "UNKNOWN" | null = "KG",
) => ({
  businessDate: date,
  sales: {
    value: sales,
    status: sales === null ? ("UNAVAILABLE" as const) : ("AVAILABLE" as const),
  },
  soldQuantity: {
    value: quantity,
    status:
      quantity === null ? ("UNAVAILABLE" as const) : ("AVAILABLE" as const),
  },
  quantityUnit: unit,
});
it("uses a weighted ratio of matching sales/quantities, retains decimal quantities and never asserts TTC", () => {
  const r = calculateSalesMeasures(period, [
    point(period.start, "10.00", "1.250"),
    point(period.end, "90.00", "8.750"),
  ]);
  expect(r).toMatchObject({
    taxBasis: "UNCONFIRMED",
    quantity: { value: "10.000", unit: "KG", status: "AVAILABLE" },
    averageRealizedPrice: {
      value: "10.00",
      unit: "KG",
      pairedDays: 2,
      pairedSalesValue: "100.00",
      pairedQuantity: "10.000",
      status: "AVAILABLE",
    },
  });
});
it("keeps quantities separate from the paired price denominator when a day's sales are missing", () => {
  const r = calculateSalesMeasures(period, [
    point(period.start, "10.00", "2"),
    point(period.end, null, "8"),
  ]);
  expect(r).toMatchObject({
    quantity: { value: "10", status: "AVAILABLE" },
    averageRealizedPrice: {
      value: "5.00",
      status: "PARTIAL",
      pairedSalesValue: "10.00",
      pairedQuantity: "2",
      pairedDays: 1,
    },
  });
});
it("does not pair independently missing quantities and sales from different dates", () => {
  const r = calculateSalesMeasures(period, [
    point(period.start, "10.00", null),
    point(period.end, null, "2"),
  ]);
  expect(r.averageRealizedPrice).toMatchObject({
    value: null,
    status: "UNAVAILABLE",
    pairedDays: 0,
  });
});
it.each(["PIECE", "PACK"] as const)(
  "keeps %s units and never converts them to kilos",
  (unit) => {
    const r = calculateSalesMeasures(period, [
      point(period.start, "10.00", "2", unit),
    ]);
    expect(r).toMatchObject({
      quantity: { value: "2", unit, status: "PARTIAL", missingDays: 1 },
      averageRealizedPrice: { value: "5.00", unit, status: "PARTIAL" },
    });
  },
);
it.each(["PIECE", null, "UNKNOWN"] as const)(
  "rejects incompatible or unknown unit %s without consulting the current catalogue",
  (unit) => {
    const r = calculateSalesMeasures(period, [
      point(period.start, "10.00", "2"),
      point(period.end, "15.00", "3", unit),
    ]);
    expect(r.quantity.status).toBe("UNAVAILABLE");
    expect(r.averageRealizedPrice.value).toBeNull();
  },
);
it.each(["0", "-2"])(
  "preserves recorded quantity %s but refuses a non-positive average-price denominator",
  (quantity) => {
    const r = calculateSalesMeasures(period, [
      point(period.start, "10.00", quantity),
    ]);
    expect(r.quantity.value).toBe(quantity);
    expect(r.averageRealizedPrice).toMatchObject({
      value: null,
      status: "UNAVAILABLE",
      reason: "NON_POSITIVE_DENOMINATOR",
    });
  },
);
it("preserves a real zero value, distinguishes no data, and filters other dates", () => {
  const r = calculateSalesMeasures(period, [
    point(period.start, "0.00", "2"),
    point("2024-10-01", "9999.00", "1"),
  ]);
  expect(r.averageRealizedPrice.value).toBe("0.00");
  expect(calculateSalesMeasures(period, [])).toMatchObject({
    quantity: { value: null, status: "UNAVAILABLE", missingDays: 2 },
    averageRealizedPrice: { value: null, status: "UNAVAILABLE" },
  });
});
it("excludes partly known daily input from the paired price instead of dividing mismatched totals", () => {
  const bad = point(period.end, "100.00", "20");
  const r = calculateSalesMeasures(period, [
    point(period.start, "10.00", "2"),
    { ...bad, sales: { ...bad.sales, status: "PARTIAL" } },
  ]);
  expect(r).toMatchObject({
    quantity: { value: "22" },
    averageRealizedPrice: { value: "5.00", status: "PARTIAL", pairedDays: 1 },
  });
});
it("preserves an existing unknown-unit diagnosis instead of asking for sales files again", () => {
  const r = calculateSalesMeasures(period, [
    {
      ...point(period.start, "10", null, null),
      soldQuantity: {
        value: null,
        status: "UNAVAILABLE",
        reason: "UNKNOWN_UNIT",
      },
    },
  ]);
  expect(r.quantity.reason).toBe("UNKNOWN_UNIT");
  expect(r.averageRealizedPrice).toMatchObject({
    reason: "UNKNOWN_UNIT",
    value: null,
  });
});
