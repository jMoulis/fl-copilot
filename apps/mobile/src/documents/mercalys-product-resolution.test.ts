import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductMatchResult } from "@fl-copilot/domain";
import type { ParsedMercalysArticleRecord } from "./mercalys-article-parser";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";
import { validateMercalysImport } from "./mercalys-import-validation";
import { buildMercalysProductResolutions } from "./mercalys-product-resolution";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";

describe("Mercalys product resolution", () => {
  it("groups repeated rows by ITM8 and preserves leading zeroes", () => {
    const result = buildMercalysProductResolutions(
      summary([
        line(8, "00000042", "0000000000042", "Poire conférence"),
        line(9, "00000042", "0000000000042", "Poire conférence"),
      ]),
    );

    expect(result).toEqual([
      expect.objectContaining({
        key: "ITM8:00000042",
        label: "Poire conférence",
        identifiers: [
          { type: "ITM8", value: "00000042" },
          { type: "EAN", value: "0000000000042" },
        ],
        sourceIndexes: [8, 9],
        canCreate: true,
      }),
    ]);
  });

  it("does not batch-create an ambiguous mapping or inconsistent labels", () => {
    const candidateId = "22222222-2222-4222-8222-222222222222";
    const result = buildMercalysProductResolutions(
      summary([
        line(8, "00000042", null, "Poire conférence"),
        line(9, "00000042", null, "Pomme Gala", match("REVIEW", candidateId)),
      ]),
    );

    expect(result[0]).toMatchObject({
      canCreate: false,
      candidateProductIds: [candidateId],
    });
  });

  it("blocks batch creation when two products claim the same identifier", () => {
    const result = buildMercalysProductResolutions(
      summary([
        line(8, "00000041", "0000000000042", "Poire conférence"),
        line(9, "00000042", "0000000000042", "Pomme Gala"),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result.every(({ canCreate }) => !canCreate)).toBe(true);
  });
});

const dailySalesFixture = resolve(
  process.cwd(),
  "docs/files_examples/ventes_day_example.xlsx",
);
describe.skipIf(!existsSync(dailySalesFixture))(
  "real Mercalys product resolution",
  () => {
    it("can explicitly initialize an empty Product Master from the daily sales file", () => {
      const workbook = new SheetJsSpreadsheetParser().parse(
        readFileSync(dailySalesFixture),
      );
      const importSummary = validateMercalysImport(
        workbook,
        "11111111-1111-4111-8111-111111111111",
        { products: [], identifiers: [], aliases: [] },
      );
      const resolutions = buildMercalysProductResolutions(importSummary);

      expect(importSummary).toMatchObject({
        detectedLineCount: 147,
        readyCount: 0,
        productReviewCount: 147,
      });
      expect(resolutions).toHaveLength(147);
      expect(resolutions.every(({ canCreate }) => canCreate)).toBe(true);
    });
  },
);

function line(
  sourceIndex: number,
  itm8: string | null,
  ean: string | null,
  rawLabel: string,
  productMatch: ProductMatchResult = match("NO_MATCH"),
) {
  const record: ParsedMercalysArticleRecord = {
    sourceIndex,
    itm8,
    ean,
    rawLabel,
    businessDate: "2026-09-26",
    quantity: 1,
    purchaseValue: null,
    rceValue: null,
    salesValue: 2,
    vatValue: null,
    marginValue: null,
    marginRate: null,
    rawValues: {
      itm8,
      ean,
      rawLabel,
      businessDate: "2026-09-26",
      quantity: 1,
      purchaseValue: null,
      rceValue: null,
      salesValue: 2,
      vatValue: null,
      marginValue: null,
      marginRate: null,
    },
  };
  return { record, match: productMatch };
}

function match(
  state: ProductMatchResult["state"],
  candidateProductId?: string,
): ProductMatchResult {
  return {
    engineVersion: "test",
    state,
    matchedProductId: null,
    method: state === "REVIEW" ? "FUZZY_LABEL" : null,
    candidates: candidateProductId
      ? [
          {
            productId: candidateProductId,
            score: 0.85,
            method: "FUZZY_LABEL",
            reasons: ["FUZZY_LABEL"],
          },
        ]
      : [],
    conflict: null,
  };
}

function summary(
  lines: MercalysImportValidationSummary["lines"],
): MercalysImportValidationSummary {
  return {
    sourceType: "MERCALYS_SALES",
    parserVersion: "test",
    businessPeriodStart: "2026-09-26",
    businessPeriodEnd: "2026-09-26",
    detectedLineCount: lines.length,
    readyCount: 0,
    productReviewCount: lines.length,
    errorCount: 0,
    lines,
    issueCodes: [],
  };
}
