import type { Product } from "@fl-copilot/domain";
import {
  addDecimals,
  addMoney,
  divideDecimals,
  parseDecimal,
  serializeDecimal,
  type DecimalString,
} from "./decimal";

export type SalesUnit = Product["salesUnit"];
export type FormulaStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type FormulaUnavailableReason =
  | "MISSING_INPUT"
  | "INCOMPATIBLE_UNITS"
  | "UNKNOWN_UNIT"
  | "NON_POSITIVE_DENOMINATOR";

export interface DecimalFormulaResult {
  readonly value: DecimalString | null;
  readonly status: FormulaStatus;
  readonly inputCount: number;
  readonly availableInputCount: number;
  readonly missingInputCount: number;
  readonly reason?: FormulaUnavailableReason;
}

export interface QuantityInput {
  readonly value: string | null | undefined;
  readonly unit: SalesUnit;
}

export interface QuantityFormulaResult extends DecimalFormulaResult {
  readonly unit: Exclude<SalesUnit, "UNKNOWN"> | null;
}

export interface RatioFormulaResult extends DecimalFormulaResult {
  readonly scale: number;
}

export interface ComparisonAvailability {
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly reason?: "MISSING_CURRENT" | "MISSING_REFERENCE";
}

export function sumAvailableDecimals(
  values: readonly (string | null | undefined)[],
): DecimalFormulaResult {
  const available = values.filter(isPresent);
  if (available.length === 0)
    return unavailable(values.length, "MISSING_INPUT");

  return {
    value: addDecimals(available),
    status: available.length === values.length ? "AVAILABLE" : "PARTIAL",
    inputCount: values.length,
    availableInputCount: available.length,
    missingInputCount: values.length - available.length,
  };
}

export function sumAvailableCurrency(
  values: readonly (string | null | undefined)[],
): DecimalFormulaResult {
  const available = values.filter(isPresent);
  if (available.length === 0)
    return unavailable(values.length, "MISSING_INPUT");

  return {
    value: addMoney(available).amount,
    status: available.length === values.length ? "AVAILABLE" : "PARTIAL",
    inputCount: values.length,
    availableInputCount: available.length,
    missingInputCount: values.length - available.length,
  };
}

export function sumCompatibleQuantities(
  inputs: readonly QuantityInput[],
): QuantityFormulaResult {
  const available = inputs.filter(
    (input): input is QuantityInput & { value: string } =>
      isPresent(input.value),
  );
  if (available.length === 0) {
    return { ...unavailable(inputs.length, "MISSING_INPUT"), unit: null };
  }
  if (available.some((input) => input.unit === "UNKNOWN")) {
    return { ...unavailable(inputs.length, "UNKNOWN_UNIT"), unit: null };
  }

  const units = new Set(available.map((input) => input.unit));
  if (units.size !== 1) {
    return {
      ...unavailable(inputs.length, "INCOMPATIBLE_UNITS"),
      unit: null,
    };
  }

  const unit = available[0]?.unit;
  if (!unit || unit === "UNKNOWN") {
    return { ...unavailable(inputs.length, "UNKNOWN_UNIT"), unit: null };
  }

  return {
    value: addDecimals(available.map((input) => input.value)),
    unit,
    status: available.length === inputs.length ? "AVAILABLE" : "PARTIAL",
    inputCount: inputs.length,
    availableInputCount: available.length,
    missingInputCount: inputs.length - available.length,
  };
}

export function computeRatio(
  numerator: string | null | undefined,
  denominator: string | null | undefined,
  scale = 4,
): RatioFormulaResult {
  if (!isPresent(numerator) || !isPresent(denominator)) {
    const availableInputCount =
      Number(isPresent(numerator)) + Number(isPresent(denominator));
    return {
      value: null,
      status: "UNAVAILABLE",
      scale,
      inputCount: 2,
      availableInputCount,
      missingInputCount: 2 - availableInputCount,
      reason: "MISSING_INPUT",
    };
  }

  if (parseDecimal(denominator).value.lessThanOrEqualTo(0)) {
    return {
      value: null,
      status: "UNAVAILABLE",
      scale,
      inputCount: 2,
      availableInputCount: 2,
      missingInputCount: 0,
      reason: "NON_POSITIVE_DENOMINATOR",
    };
  }

  return {
    value: divideDecimals(numerator, denominator, scale),
    status: "AVAILABLE",
    scale,
    inputCount: 2,
    availableInputCount: 2,
    missingInputCount: 0,
  };
}

export function computeAverageRealizedPrice(
  salesValues: readonly (string | null | undefined)[],
  quantities: readonly QuantityInput[],
): QuantityFormulaResult {
  const sales = sumAvailableCurrency(salesValues);
  const quantity = sumCompatibleQuantities(quantities);
  if (sales.value === null) return { ...sales, unit: quantity.unit };
  if (quantity.value === null) return quantity;

  const ratio = computeRatio(sales.value, quantity.value, 2);
  return {
    ...ratio,
    unit: quantity.unit,
    status:
      ratio.status === "AVAILABLE" &&
      (sales.status === "PARTIAL" || quantity.status === "PARTIAL")
        ? "PARTIAL"
        : ratio.status,
    inputCount: sales.inputCount + quantity.inputCount,
    availableInputCount:
      sales.availableInputCount + quantity.availableInputCount,
    missingInputCount: sales.missingInputCount + quantity.missingInputCount,
  };
}

export function computeWasteOutputShare(
  sold: QuantityFormulaResult,
  waste: QuantityFormulaResult,
  scale = 4,
): RatioFormulaResult {
  if (sold.value === null || waste.value === null) {
    return unavailableRatio(scale, "MISSING_INPUT");
  }
  if (sold.unit === null || waste.unit === null || sold.unit !== waste.unit) {
    return unavailableRatio(scale, "INCOMPATIBLE_UNITS");
  }

  const denominator = parseDecimal(sold.value).value.plus(
    parseDecimal(waste.value).value,
  );
  if (denominator.lessThanOrEqualTo(0)) {
    return unavailableRatio(scale, "NON_POSITIVE_DENOMINATOR");
  }

  return {
    value: serializeDecimal(
      parseDecimal(waste.value).value.dividedBy(denominator),
      scale,
    ),
    status:
      sold.status === "PARTIAL" || waste.status === "PARTIAL"
        ? "PARTIAL"
        : "AVAILABLE",
    scale,
    inputCount: sold.inputCount + waste.inputCount,
    availableInputCount: sold.availableInputCount + waste.availableInputCount,
    missingInputCount: sold.missingInputCount + waste.missingInputCount,
  };
}

export function comparisonAvailability(
  current: string | null | undefined,
  reference: string | null | undefined,
): ComparisonAvailability {
  if (!isPresent(current))
    return { status: "UNAVAILABLE", reason: "MISSING_CURRENT" };
  if (!isPresent(reference)) {
    return { status: "UNAVAILABLE", reason: "MISSING_REFERENCE" };
  }
  return { status: "AVAILABLE" };
}

function unavailable(
  inputCount: number,
  reason: FormulaUnavailableReason,
): DecimalFormulaResult {
  return {
    value: null,
    status: "UNAVAILABLE",
    inputCount,
    availableInputCount: 0,
    missingInputCount: inputCount,
    reason,
  };
}

function unavailableRatio(
  scale: number,
  reason: FormulaUnavailableReason,
): RatioFormulaResult {
  return {
    ...unavailable(2, reason),
    scale,
  };
}

function isPresent(value: string | null | undefined): value is string {
  return value !== null && value !== undefined;
}
