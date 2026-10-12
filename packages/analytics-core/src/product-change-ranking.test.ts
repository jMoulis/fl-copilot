import { expect, it } from "vitest";
import {
  rankProductDailyChanges,
  type ProductChangePoint,
} from "./product-change-ranking";
const point = (
  productId: string,
  value: string | null,
  date = "2026-10-08",
  status: ProductChangePoint["status"] = "AVAILABLE",
): ProductChangePoint => ({
  storeId: "store",
  productId,
  value,
  businessDate: date,
  status,
});
it("ranks exact euro differences, excludes missing/partial comparisons and preserves zero-denominator limitations", () => {
  const result = rankProductDailyChanges({
    storeId: "store",
    businessDate: "2026-10-08",
    metric: "sales",
    direction: "DECREASE",
    current: [
      point("a", "0.001"),
      point("b", "0.0009"),
      point("new", "100"),
      point("partial", "0", undefined, "PARTIAL"),
    ],
    reference: [
      point("a", "1", "2026-10-01"),
      point("b", "1", "2026-10-01"),
      point("partial", "999", "2026-10-01"),
    ],
  });
  expect(result.changes.map((c) => c.productId)).toEqual(["b", "a"]);
  expect(result.comparedProductCount).toBe(2);
  expect(result.excludedProductCount).toBe(2);
  const increase = rankProductDailyChanges({
    storeId: "store",
    businessDate: "2026-10-08",
    metric: "margin",
    direction: "INCREASE",
    current: [point("a", "3")],
    reference: [point("a", "0", "2026-10-01")],
  });
  expect(increase.changes[0]?.comparison.percentageDifference).toBeNull();
  expect(increase.changes[0]?.comparison.absoluteDifference).toBe("3");
  expect(() =>
    rankProductDailyChanges({
      storeId: "foreign",
      businessDate: "2026-10-08",
      metric: "sales",
      direction: "DECREASE",
      current: [point("a", "1")],
      reference: [],
    }),
  ).toThrow("PRODUCT_CHANGE_SCOPE_INVALID");
});
