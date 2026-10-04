import {
  multiplyToMoney,
  parseDecimal,
  serializeDecimal,
  type DecimalString,
} from "./decimal";

export const WASTE_RECEIPT_ARITHMETIC_VALIDATOR_VERSION =
  "waste-receipt.arithmetic.v1";
export const DEFAULT_WASTE_RECEIPT_ARITHMETIC_TOLERANCE_EUR = "0.01";

export type WasteReceiptArithmeticField = "weight" | "unitPrice" | "totalPrice";
export type WasteReceiptArithmeticStatus =
  "NOT_CHECKED" | "CONSISTENT" | "MISMATCH";

export interface WasteReceiptArithmeticInputLine {
  readonly sourceLineIndex: number;
  readonly weight: string | null;
  readonly unitPrice: string | null;
  readonly totalPrice: string | null;
}

export interface WasteReceiptArithmeticLineResult {
  readonly sourceLineIndex: number;
  readonly status: WasteReceiptArithmeticStatus;
  readonly expectedTotal: DecimalString | null;
  readonly observedTotal: DecimalString | null;
  readonly absoluteDifference: DecimalString | null;
  readonly tolerance: DecimalString;
  readonly missingFields: readonly WasteReceiptArithmeticField[];
  readonly warningCode: "AMOUNT_TO_REVIEW" | null;
}

export interface WasteReceiptArithmeticValidationResult {
  readonly validatorVersion: typeof WASTE_RECEIPT_ARITHMETIC_VALIDATOR_VERSION;
  readonly tolerance: DecimalString;
  readonly checkedLineCount: number;
  readonly consistentLineCount: number;
  readonly mismatchLineCount: number;
  readonly uncheckedLineCount: number;
  readonly hasWarnings: boolean;
  readonly lines: readonly WasteReceiptArithmeticLineResult[];
}

export function validateWasteReceiptArithmetic(
  lines: readonly WasteReceiptArithmeticInputLine[],
  tolerance = DEFAULT_WASTE_RECEIPT_ARITHMETIC_TOLERANCE_EUR,
): WasteReceiptArithmeticValidationResult {
  const parsedTolerance = nonNegativeDecimal(tolerance, "tolerance");
  if (parsedTolerance.scale > 2) {
    throw new Error("tolerance must use at most two decimal places.");
  }
  const canonicalTolerance = serializeDecimal(parsedTolerance.value, 2);
  const results = lines.map((line) => validateLine(line, canonicalTolerance));
  const consistentLineCount = countStatus(results, "CONSISTENT");
  const mismatchLineCount = countStatus(results, "MISMATCH");
  const uncheckedLineCount = countStatus(results, "NOT_CHECKED");

  return {
    validatorVersion: WASTE_RECEIPT_ARITHMETIC_VALIDATOR_VERSION,
    tolerance: canonicalTolerance,
    checkedLineCount: consistentLineCount + mismatchLineCount,
    consistentLineCount,
    mismatchLineCount,
    uncheckedLineCount,
    hasWarnings: mismatchLineCount > 0,
    lines: results,
  };
}

function validateLine(
  line: WasteReceiptArithmeticInputLine,
  tolerance: DecimalString,
): WasteReceiptArithmeticLineResult {
  const missingFields = missingArithmeticFields(line);
  if (missingFields.length > 0) {
    return {
      sourceLineIndex: line.sourceLineIndex,
      status: "NOT_CHECKED",
      expectedTotal: null,
      observedTotal:
        line.totalPrice === null
          ? null
          : serializeDecimal(
              nonNegativeDecimal(line.totalPrice, "totalPrice").value,
              2,
            ),
      absoluteDifference: null,
      tolerance,
      missingFields,
      warningCode: null,
    };
  }

  nonNegativeDecimal(line.weight!, "weight");
  nonNegativeDecimal(line.unitPrice!, "unitPrice");
  const totalPrice = nonNegativeDecimal(line.totalPrice!, "totalPrice");
  const expectedTotal = multiplyToMoney(line.weight!, line.unitPrice!).amount;
  const observedTotal = serializeDecimal(totalPrice.value, 2);
  const difference = totalPrice.value
    .minus(parseDecimal(expectedTotal).value)
    .abs();
  const differenceScale = Math.max(totalPrice.scale, 2);
  const absoluteDifference = serializeDecimal(difference, differenceScale);
  const consistent = difference.lessThanOrEqualTo(
    parseDecimal(tolerance).value,
  );

  return {
    sourceLineIndex: line.sourceLineIndex,
    status: consistent ? "CONSISTENT" : "MISMATCH",
    expectedTotal,
    observedTotal,
    absoluteDifference,
    tolerance,
    missingFields: [],
    warningCode: consistent ? null : "AMOUNT_TO_REVIEW",
  };
}

function missingArithmeticFields(
  line: WasteReceiptArithmeticInputLine,
): WasteReceiptArithmeticField[] {
  const fields: WasteReceiptArithmeticField[] = [];
  if (line.weight === null) fields.push("weight");
  if (line.unitPrice === null) fields.push("unitPrice");
  if (line.totalPrice === null) fields.push("totalPrice");
  return fields;
}

function nonNegativeDecimal(value: string, field: string) {
  const parsed = parseDecimal(value);
  if (parsed.value.isNegative()) {
    throw new Error(`${field} must be non-negative.`);
  }
  return parsed;
}

function countStatus(
  lines: readonly WasteReceiptArithmeticLineResult[],
  status: WasteReceiptArithmeticStatus,
) {
  return lines.filter((line) => line.status === status).length;
}
