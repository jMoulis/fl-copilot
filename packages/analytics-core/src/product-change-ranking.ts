import { compareJMinus7, type ComparisonResult } from "./comparison";
import { parseDecimal } from "./decimal";
import type { FormulaStatus } from "./formulas";

export interface ProductChangePoint {
  storeId: string;
  productId: string;
  businessDate: string;
  value: string | null;
  status: FormulaStatus;
}
/** Monetary changes in comparable products. Not causal attribution or a complete department decomposition. */
export function rankProductDailyChanges(input: {
  storeId: string;
  businessDate: string;
  metric: "sales" | "margin";
  direction: "INCREASE" | "DECREASE";
  current: readonly ProductChangePoint[];
  reference: readonly ProductChangePoint[];
}) {
  const referenceDate = new Date(
    Date.parse(`${input.businessDate}T00:00:00Z`) - 7 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const collect = (points: readonly ProductChangePoint[], date: string) => {
    const map = new Map<string, ProductChangePoint>();
    for (const p of points) {
      if (
        p.storeId !== input.storeId ||
        p.businessDate !== date ||
        map.has(p.productId)
      )
        throw new Error("PRODUCT_CHANGE_SCOPE_INVALID");
      map.set(p.productId, p);
    }
    return map;
  };
  const current = collect(input.current, input.businessDate),
    reference = collect(input.reference, referenceDate);
  const ids = new Set([...current.keys(), ...reference.keys()]);
  const changes: { productId: string; comparison: ComparisonResult }[] = [];
  let comparedProductCount = 0;
  for (const productId of ids) {
    const c = current.get(productId),
      r = reference.get(productId);
    if (
      !c ||
      !r ||
      c.status !== "AVAILABLE" ||
      r.status !== "AVAILABLE" ||
      c.value === null ||
      r.value === null
    )
      continue;
    const comparison = compareJMinus7({
      kpiId: input.metric,
      current: c,
      history: [r],
    });
    if (comparison.absoluteDifference === null) continue;
    comparedProductCount++;
    const sign = parseDecimal(comparison.absoluteDifference).value.comparedTo(
      0,
    );
    if (
      (input.direction === "DECREASE" && sign < 0) ||
      (input.direction === "INCREASE" && sign > 0)
    )
      changes.push({ productId, comparison });
  }
  changes.sort((a, b) => {
    const order = parseDecimal(
      a.comparison.absoluteDifference!,
    ).value.comparedTo(parseDecimal(b.comparison.absoluteDifference!).value);
    return (
      (input.direction === "DECREASE" ? order : -order) ||
      a.productId.localeCompare(b.productId)
    );
  });
  return {
    referenceDate,
    comparedProductCount,
    excludedProductCount: ids.size - comparedProductCount,
    changes: changes.slice(0, 3),
  };
}
