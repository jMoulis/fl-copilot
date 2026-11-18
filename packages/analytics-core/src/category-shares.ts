import { parseDecimal } from "./decimal";

/** Shares of available category amounts, never of an unrelated department total.
 * Missing categories stay unknown. Signed amounts and averages are not pie data.
 */
export function categoryShares<
  T extends { category: string; amount: string | null },
>(rows: readonly T[], aggregation: "SUM" | "AVERAGE" = "SUM") {
  const known = rows.filter(
    (r): r is T & { amount: string } => r.amount !== null,
  );
  const missing = rows.length - known.length;
  const negative = known.some((r) => parseDecimal(r.amount).value.lessThan(0));
  const total = known.reduce(
    (sum, r) => sum.add(parseDecimal(r.amount).value),
    parseDecimal("0").value,
  );
  const reason =
    aggregation === "AVERAGE"
      ? "AVERAGE"
      : negative
        ? "NEGATIVE"
        : total.isZero()
          ? "NO_POSITIVE_TOTAL"
          : null;
  return {
    total: known.length ? total.toFixed(2) : null,
    missing,
    reason,
    slices: reason
      ? []
      : known
          .filter((r) => parseDecimal(r.amount).value.greaterThan(0))
          .map((r) => {
            const ratio = parseDecimal(r.amount).value.div(total);
            return {
              ...r,
              fraction: ratio.toNumber(),
              percentage: ratio.mul(100).toFixed(1),
            };
          }),
  };
}
