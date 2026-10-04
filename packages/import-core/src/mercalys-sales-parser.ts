import {
  MercalysArticleParseError,
  parseMercalysArticleReport,
} from "./mercalys-article-parser";
import type {
  MercalysArticleControlTotals,
  MercalysArticleParseIssue,
  MercalysArticleParseIssueCode,
  MercalysArticleParseResult,
  ParsedMercalysArticleRecord,
} from "./mercalys-article-parser";
import type { SpreadsheetWorkbook } from "./spreadsheet-parser";

export const MERCALYS_SALES_PARSER_VERSION = "mercalys-sales.article.v1";

export type ParsedMercalysSalesRecord = ParsedMercalysArticleRecord;
export type MercalysSalesControlTotals = MercalysArticleControlTotals;
export type MercalysSalesParseIssueCode = MercalysArticleParseIssueCode;
export type MercalysSalesParseIssue = MercalysArticleParseIssue;
export type MercalysSalesParseResult = Omit<
  MercalysArticleParseResult<"MERCALYS_SALES">,
  "parserVersion"
> & {
  parserVersion: typeof MERCALYS_SALES_PARSER_VERSION;
};

export type MercalysSalesParseErrorCode =
  | "MERCALYS_SALES_FORMAT_UNSUPPORTED"
  | "MERCALYS_SOURCE_TYPE_MISMATCH"
  | "MERCALYS_SALES_SHEET_MISSING";

export class MercalysSalesParseError extends Error {
  constructor(readonly code: MercalysSalesParseErrorCode) {
    super(code);
    this.name = "MercalysSalesParseError";
  }
}

export function parseMercalysSales(
  workbook: SpreadsheetWorkbook,
): MercalysSalesParseResult {
  try {
    return parseMercalysArticleReport(
      workbook,
      "MERCALYS_SALES",
      MERCALYS_SALES_PARSER_VERSION,
    ) as MercalysSalesParseResult;
  } catch (error) {
    if (!(error instanceof MercalysArticleParseError)) throw error;
    const code: MercalysSalesParseErrorCode =
      error.code === "MERCALYS_FORMAT_UNSUPPORTED"
        ? "MERCALYS_SALES_FORMAT_UNSUPPORTED"
        : error.code === "MERCALYS_SHEET_MISSING"
          ? "MERCALYS_SALES_SHEET_MISSING"
          : "MERCALYS_SOURCE_TYPE_MISMATCH";
    throw new MercalysSalesParseError(code);
  }
}
