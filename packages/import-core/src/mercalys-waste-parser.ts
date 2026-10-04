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

export const MERCALYS_WASTE_PARSER_VERSION = "mercalys-waste.article.v1";

export type ParsedMercalysWasteRecord = ParsedMercalysArticleRecord;
export type MercalysWasteControlTotals = MercalysArticleControlTotals;
export type MercalysWasteParseIssueCode = MercalysArticleParseIssueCode;
export type MercalysWasteParseIssue = MercalysArticleParseIssue;
export type MercalysWasteParseResult = Omit<
  MercalysArticleParseResult<"MERCALYS_WASTE">,
  "parserVersion"
> & {
  parserVersion: typeof MERCALYS_WASTE_PARSER_VERSION;
};

export type MercalysWasteParseErrorCode =
  | "MERCALYS_WASTE_FORMAT_UNSUPPORTED"
  | "MERCALYS_SOURCE_TYPE_MISMATCH"
  | "MERCALYS_WASTE_SHEET_MISSING";

export class MercalysWasteParseError extends Error {
  constructor(readonly code: MercalysWasteParseErrorCode) {
    super(code);
    this.name = "MercalysWasteParseError";
  }
}

export function parseMercalysWaste(
  workbook: SpreadsheetWorkbook,
): MercalysWasteParseResult {
  try {
    return parseMercalysArticleReport(
      workbook,
      "MERCALYS_WASTE",
      MERCALYS_WASTE_PARSER_VERSION,
    ) as MercalysWasteParseResult;
  } catch (error) {
    if (!(error instanceof MercalysArticleParseError)) throw error;
    const code: MercalysWasteParseErrorCode =
      error.code === "MERCALYS_FORMAT_UNSUPPORTED"
        ? "MERCALYS_WASTE_FORMAT_UNSUPPORTED"
        : error.code === "MERCALYS_SHEET_MISSING"
          ? "MERCALYS_WASTE_SHEET_MISSING"
          : "MERCALYS_SOURCE_TYPE_MISMATCH";
    throw new MercalysWasteParseError(code);
  }
}
