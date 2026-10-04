import { describe, expect, it } from "vitest";
import {
  validateWasteReceiptArithmetic,
  WASTE_RECEIPT_ARITHMETIC_VALIDATOR_VERSION,
} from "./waste-receipt-arithmetic";

describe("waste receipt arithmetic validation", () => {
  it("accepts rounded weight multiplication within the configured tolerance", () => {
    expect(
      validateWasteReceiptArithmetic([
        {
          sourceLineIndex: 0,
          weight: "0.580",
          unitPrice: "4.99",
          totalPrice: "2.89",
        },
      ]),
    ).toEqual({
      validatorVersion: WASTE_RECEIPT_ARITHMETIC_VALIDATOR_VERSION,
      tolerance: "0.01",
      checkedLineCount: 1,
      consistentLineCount: 1,
      mismatchLineCount: 0,
      uncheckedLineCount: 0,
      hasWarnings: false,
      lines: [
        {
          sourceLineIndex: 0,
          status: "CONSISTENT",
          expectedTotal: "2.89",
          observedTotal: "2.89",
          absoluteDifference: "0.00",
          tolerance: "0.01",
          missingFields: [],
          warningCode: null,
        },
      ],
    });
  });

  it("flags a mismatch without changing any extracted value", () => {
    const result = validateWasteReceiptArithmetic([
      {
        sourceLineIndex: 7,
        weight: "0.580",
        unitPrice: "4.99",
        totalPrice: "3.20",
      },
    ]);

    expect(result.hasWarnings).toBe(true);
    expect(result.lines[0]).toEqual({
      sourceLineIndex: 7,
      status: "MISMATCH",
      expectedTotal: "2.89",
      observedTotal: "3.20",
      absoluteDifference: "0.31",
      tolerance: "0.01",
      missingFields: [],
      warningCode: "AMOUNT_TO_REVIEW",
    });
  });

  it("applies an explicit tolerance without hiding the measured difference", () => {
    const result = validateWasteReceiptArithmetic(
      [
        {
          sourceLineIndex: 4,
          weight: "1",
          unitPrice: "2.89",
          totalPrice: "2.91",
        },
      ],
      "0.02",
    );

    expect(result).toMatchObject({
      tolerance: "0.02",
      consistentLineCount: 1,
      mismatchLineCount: 0,
      lines: [
        {
          status: "CONSISTENT",
          absoluteDifference: "0.02",
          tolerance: "0.02",
        },
      ],
    });
  });

  it("keeps incomplete lines visible without inventing an arithmetic result", () => {
    const result = validateWasteReceiptArithmetic([
      {
        sourceLineIndex: 3,
        weight: null,
        unitPrice: "2.50",
        totalPrice: null,
      },
    ]);

    expect(result).toMatchObject({
      checkedLineCount: 0,
      uncheckedLineCount: 1,
      hasWarnings: false,
      lines: [
        {
          sourceLineIndex: 3,
          status: "NOT_CHECKED",
          expectedTotal: null,
          observedTotal: null,
          absoluteDifference: null,
          missingFields: ["weight", "totalPrice"],
          warningCode: null,
        },
      ],
    });
  });
});
