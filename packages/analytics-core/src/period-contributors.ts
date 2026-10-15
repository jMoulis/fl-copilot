import {
  copilotAnalysisPeriodSchema,
  copilotBusinessDateSchema,
} from "@fl-copilot/domain";
import { addDecimals, parseDecimal } from "./decimal";
import type { ProductChangePoint } from "./product-change-ranking";
/** Rank only observed monetary sums, never estimated missing days or causal impact. */
export function rankPeriodContributors(input: {
  storeId: string;
  period: { start: string; end: string };
  points: readonly ProductChangePoint[];
}) {
  const period = copilotAnalysisPeriodSchema.parse(input.period);
  const seen = new Set<string>(),
    products = new Map<
      string,
      { values: string[]; knownDays: number; incompleteDays: number }
    >();
  for (const p of input.points) {
    copilotBusinessDateSchema.parse(p.businessDate);
    const key = `${p.productId}/${p.businessDate}`;
    if (
      p.storeId !== input.storeId ||
      p.businessDate < period.start ||
      p.businessDate > period.end ||
      seen.has(key)
    )
      throw Error("PERIOD_CONTRIBUTOR_SCOPE_INVALID");
    seen.add(key);
    const product = products.get(p.productId) ?? {
      values: [],
      knownDays: 0,
      incompleteDays: 0,
    };
    if (p.value !== null && p.status !== "UNAVAILABLE") {
      parseDecimal(p.value);
      product.values.push(p.value);
      product.knownDays++;
    }
    if (p.status !== "AVAILABLE" || p.value === null) product.incompleteDays++;
    products.set(p.productId, product);
  }
  const amounts = [...products].flatMap(([productId, p]) =>
    p.values.length
      ? [
          {
            productId,
            amount: addDecimals(p.values),
            knownDays: p.knownDays,
            incompleteDays: p.incompleteDays,
          },
        ]
      : [],
  );
  amounts.sort(
    (a, b) =>
      parseDecimal(b.amount).value.comparedTo(parseDecimal(a.amount).value) ||
      a.productId.localeCompare(b.productId),
  );
  return {
    knownProductCount: amounts.length,
    unavailableProductCount: products.size - amounts.length,
    products: amounts
      .filter((p) => parseDecimal(p.amount).value.greaterThan(0))
      .slice(0, 5),
  };
}
