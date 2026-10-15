import { it, expect } from "vitest";
import { rankPeriodContributors } from "./period-contributors";
const base = {
  storeId: "store",
  businessDate: "2026-10-01",
  status: "AVAILABLE" as const,
};
const period = { start: "2026-10-01", end: "2026-10-15" };
it("ranks exact known monetary sums over available days without inventing missing observations", () => {
  const result = rankPeriodContributors({
    storeId: "store",
    period,
    points: [
      { ...base, productId: "banana", value: "0.1" },
      {
        ...base,
        productId: "banana",
        businessDate: "2026-10-03",
        value: "0.2",
        status: "PARTIAL",
      },
      { ...base, productId: "pear", value: "10.50" },
      { ...base, productId: "unknown", value: null },
      {
        ...base,
        productId: "unavailable",
        status: "UNAVAILABLE",
        value: "999",
      },
    ],
  });
  expect(result.products.map((p) => [p.productId, p.amount])).toEqual([
    ["pear", "10.50"],
    ["banana", "0.3"],
  ]);
  expect(result.products[1]).toMatchObject({ knownDays: 2, incompleteDays: 1 });
  expect(result.unavailableProductCount).toBe(2);
});
it("rejects other stores, dates and duplicate product/day facts before summing", () => {
  const point = { ...base, productId: "banana", value: "1" };
  for (const points of [
    [point, point],
    [{ ...point, storeId: "other" }],
    [{ ...point, businessDate: "2025-10-01" }],
  ])
    expect(() =>
      rankPeriodContributors({ storeId: "store", period, points }),
    ).toThrow("PERIOD_CONTRIBUTOR_SCOPE_INVALID");
});
it("keeps a deterministic top five and does not rank zero or reversed net amounts as losses", () => {
  const points = Array.from({ length: 8 }, (_, i) => ({
    ...base,
    productId: String(i),
    value: String(i - 1),
  }));
  expect(
    rankPeriodContributors({ storeId: "store", period, points }).products.map(
      (p) => p.productId,
    ),
  ).toEqual(["7", "6", "5", "4", "3"]);
});
