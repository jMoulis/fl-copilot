import { expect, it } from "vitest";
import { categoryShares } from "./category-shares";
it("uses all available category amounts and keeps unavailable categories outside the denominator", () => {
  const result = categoryShares([
    { category: "FRUIT", amount: "1236.71" },
    { category: "VEGETABLE", amount: "1136.51" },
    { category: "UNKNOWN", amount: null },
  ]);
  expect(result.total).toBe("2373.22");
  expect(result.missing).toBe(1);
  expect(result.slices.map((s) => s.percentage)).toEqual(["52.1", "47.9"]);
  expect(result.slices.reduce((n, s) => n + s.fraction, 0)).toBeCloseTo(1);
});
it.each([
  [["10", "-2"], "SUM", "NEGATIVE"],
  [["0", null], "SUM", "NO_POSITIVE_TOTAL"],
  [[null, null], "SUM", "NO_POSITIVE_TOTAL"],
  [["10", "20"], "AVERAGE", "AVERAGE"],
] as const)(
  "does not manufacture shares for %j (%s)",
  (amounts, aggregation, reason) => {
    const result = categoryShares(
      amounts.map((amount, i) => ({ category: String(i), amount })),
      aggregation,
    );
    expect(result.reason).toBe(reason);
    expect(result.slices).toEqual([]);
  },
);
it("keeps zero distinct from unknown and decimal monetary totals exact", () => {
  const result = categoryShares([
    { category: "a", amount: "0.1" },
    { category: "b", amount: "0.2" },
    { category: "c", amount: "0" },
  ]);
  expect(result.total).toBe("0.30");
  expect(result.missing).toBe(0);
  expect(result.slices).toHaveLength(2);
});
