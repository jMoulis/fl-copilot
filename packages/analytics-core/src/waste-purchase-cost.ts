import { addDecimals } from "./decimal";
import type { FormulaStatus } from "./formulas";

/** Existing Today policy: known + estimated purchase amounts, never selling value. */
export function wastePurchaseCost(input: {
  waste: {
    purchaseValueKnown?: string | null;
    purchaseValueEstimated?: string | null;
  };
  availability: {
    wastePurchaseValueKnown?: { status: FormulaStatus };
    wastePurchaseValueEstimated?: { status: FormulaStatus };
  };
}): { value: string | null; status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" } {
  const known = input.waste.purchaseValueKnown ?? null;
  const estimated = input.waste.purchaseValueEstimated ?? null;
  if (known === null && estimated === null)
    return { value: null, status: "UNAVAILABLE" };
  const value = addDecimals(
    [known, estimated].filter((v): v is string => v !== null),
  );
  const knownStatus =
    input.availability.wastePurchaseValueKnown?.status ?? "UNAVAILABLE";
  const estimatedStatus =
    input.availability.wastePurchaseValueEstimated?.status ?? "UNAVAILABLE";
  const status =
    known !== null && knownStatus === "AVAILABLE" && estimated === null
      ? "AVAILABLE"
      : knownStatus === "AVAILABLE" && estimatedStatus === "AVAILABLE"
        ? "AVAILABLE"
        : "PARTIAL";
  return { value, status };
}
