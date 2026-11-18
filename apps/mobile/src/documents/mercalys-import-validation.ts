import { parseMercalysPurchasePrices } from "@fl-copilot/import-core";
import {
  matchProduct,
  prepareProductMatcher,
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
  sourceStoreCode?: string | null;
}

function parseImport(workbook: SpreadsheetWorkbook) {
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
    detection.sourceType === "MERCALYS_PURCHASE_PRICES"
      ? parseMercalysPurchasePrices(workbook)
      : detection.sourceType === "MERCALYS_SALES"
        ? parseMercalysSales(workbook)
        : parseMercalysWaste(workbook);
  return {
    sourceType: detection.sourceType,
    ...("storeCode" in parsed ? { sourceStoreCode: parsed.storeCode } : {}),
    parserVersion: parsed.parserVersion,
    businessPeriodStart: parsed.businessPeriodStart,
    businessPeriodEnd: parsed.businessPeriodEnd,
    detectedLineCount:
      parsed.declaredLineCount ?? parsed.records.length + parsed.issues.length,
    records: parsed.records,
    errorCount: parsed.issues.length,
    issueCodes: [...new Set(parsed.issues.map((issue) => issue.code))],
  };
}

function matchRecord(
  record: ParsedMercalysArticleRecord,
  storeId: string,
  catalog: ProductMatchCatalog,
  matcher?: ReturnType<typeof prepareProductMatcher>,
): MercalysImportValidationLine {
  return {
    record,
    match: (matcher ?? ((request) => matchProduct(request, catalog)))({
      storeId,
      identifiers: [
        ...(record.itm8 ? [{ type: "ITM8" as const, value: record.itm8 }] : []),
        ...(record.ean ? [{ type: "EAN" as const, value: record.ean }] : []),
      ],
      label: record.rawLabel,
    }),
  };
}
function withMatches(
  summary: Omit<
    MercalysImportValidationSummary,
    "lines" | "readyCount" | "productReviewCount"
  >,
  lines: MercalysImportValidationLine[],
): MercalysImportValidationSummary {
  const readyCount = lines.filter(
    (line) => line.match.state === "AUTO_MATCH",
  ).length;
  return {
    sourceType: summary.sourceType,
    ...("sourceStoreCode" in summary
      ? { sourceStoreCode: summary.sourceStoreCode }
      : {}),
    parserVersion: summary.parserVersion,
    businessPeriodStart: summary.businessPeriodStart,
    businessPeriodEnd: summary.businessPeriodEnd,
    detectedLineCount: summary.detectedLineCount,
    readyCount,
    productReviewCount: lines.length - readyCount,
    errorCount: summary.errorCount,
    lines,
    issueCodes: summary.issueCodes,
  };
}
export function validateMercalysImport(
  workbook: SpreadsheetWorkbook,
  storeId: string,
  catalog: ProductMatchCatalog,
): MercalysImportValidationSummary {
  const { records, ...summary } = parseImport(workbook);
  return withMatches(
    summary,
    records.map((record) => matchRecord(record, storeId, catalog)),
  );
}
export function rematchMercalysImport(
  summary: MercalysImportValidationSummary,
  storeId: string,
  catalog: ProductMatchCatalog,
): MercalysImportValidationSummary {
  return withMatches(
    summary,
    summary.lines.map(({ record }) => matchRecord(record, storeId, catalog)),
  );
}

/** Preserve the deterministic matcher, but return control to native UI between slices. */
export type MercalysMatchingProgress = { completed: number; total: number };

async function matchResponsive(
  records: ParsedMercalysArticleRecord[],
  storeId: string,
  catalog: ProductMatchCatalog,
  signal?: AbortSignal,
  onProgress?: (progress: MercalysMatchingProgress) => void,
) {
  const lines: MercalysImportValidationLine[] = [];
  const matcher = prepareProductMatcher(storeId, catalog);
  let sliceStarted = Date.now();
  for (let index = 0; index < records.length; index++) {
    if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
    if (index === 0 || Date.now() - sliceStarted >= 8 || index % 20 === 0) {
      onProgress?.({ completed: index, total: records.length });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
      sliceStarted = Date.now();
    }
    lines.push(matchRecord(records[index]!, storeId, catalog, matcher));
  }
  if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
  onProgress?.({ completed: records.length, total: records.length });
  return lines;
}
export async function validateMercalysImportResponsive(
  workbook: SpreadsheetWorkbook,
  storeId: string,
  catalog: ProductMatchCatalog,
  signal?: AbortSignal,
  onProgress?: (progress: MercalysMatchingProgress) => void,
) {
  if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
  const { records, ...summary } = parseImport(workbook);
  return withMatches(
    summary,
    await matchResponsive(records, storeId, catalog, signal, onProgress),
  );
}
export async function rematchMercalysImportResponsive(
  summary: MercalysImportValidationSummary,
  storeId: string,
  catalog: ProductMatchCatalog,
  signal?: AbortSignal,
) {
  return withMatches(
    summary,
    await matchResponsive(
      summary.lines.map(({ record }) => record),
      storeId,
      catalog,
      signal,
    ),
  );
}
