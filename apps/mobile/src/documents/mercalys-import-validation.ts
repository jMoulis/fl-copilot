import {
  matchProduct,
  type ProductMatchCatalog,
  type ProductMatchResult,
} from "@fl-copilot/domain";
import type { ParsedMercalysArticleRecord } from "./mercalys-article-parser";
import { parseMercalysSales } from "./mercalys-sales-parser";
import {
  detectMercalysSource,
  type MercalysSourceType,
} from "./mercalys-source-detector";
import { parseMercalysWaste } from "./mercalys-waste-parser";
import type { SpreadsheetWorkbook } from "./spreadsheet-parser";

export type MercalysImportValidationErrorCode =
  "FORMAT_UNRECOGNIZED" | "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES";

export class MercalysImportValidationError extends Error {
  constructor(readonly code: MercalysImportValidationErrorCode) {
    super(code);
    this.name = "MercalysImportValidationError";
  }
}

export interface MercalysImportValidationLine {
  record: ParsedMercalysArticleRecord;
  match: ProductMatchResult;
}

export interface MercalysImportValidationSummary {
  sourceType: MercalysSourceType;
  parserVersion: string;
  businessPeriodStart: string;
  businessPeriodEnd: string;
  detectedLineCount: number;
  readyCount: number;
  productReviewCount: number;
  errorCount: number;
  lines: MercalysImportValidationLine[];
  issueCodes: string[];
}

export function validateMercalysImport(
  workbook: SpreadsheetWorkbook,
  storeId: string,
  catalog: ProductMatchCatalog,
): MercalysImportValidationSummary {
  const detection = detectMercalysSource(workbook);
  if (detection.status !== "DETECTED" || !detection.sourceType) {
    if (detection.reasons.includes("AGGREGATED_PERIOD_WITHOUT_DAILY_DATES")) {
      throw new MercalysImportValidationError(
        "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES",
      );
    }
    throw new MercalysImportValidationError("FORMAT_UNRECOGNIZED");
  }

  const parsed =
    detection.sourceType === "MERCALYS_SALES"
      ? parseMercalysSales(workbook)
      : parseMercalysWaste(workbook);
  const lines = parsed.records.map((record) => ({
    record,
    match: matchProduct(
      {
        storeId,
        identifiers: [
          ...(record.itm8
            ? [{ type: "ITM8" as const, value: record.itm8 }]
            : []),
          ...(record.ean ? [{ type: "EAN" as const, value: record.ean }] : []),
        ],
        label: record.rawLabel,
      },
      catalog,
    ),
  }));
  const readyCount = lines.filter(
    (line) => line.match.state === "AUTO_MATCH",
  ).length;

  return {
    sourceType: detection.sourceType,
    parserVersion: parsed.parserVersion,
    businessPeriodStart: parsed.businessPeriodStart,
    businessPeriodEnd: parsed.businessPeriodEnd,
    detectedLineCount:
      parsed.declaredLineCount ?? parsed.records.length + parsed.issues.length,
    readyCount,
    productReviewCount: lines.length - readyCount,
    errorCount: parsed.issues.length,
    lines,
    issueCodes: [...new Set(parsed.issues.map((issue) => issue.code))],
  };
}
