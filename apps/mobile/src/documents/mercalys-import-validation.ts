import {
  type PurchasePriceSelection,
  reviewPurchasePriceCollisions,
} from "./mercalys-purchase-price-review";
import { parseMercalysPurchasePrices } from "@fl-copilot/import-core";
import {
  prepareMercalysProductMatcher,
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

export type MercalysMatchingPolicy = "CODES" | "LEGACY";

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
  purchasePriceSelections?: PurchasePriceSelection[];
  publishedSourceIndexes?: number[];
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
    match: (matcher ?? prepareMercalysProductMatcher(storeId, catalog))({
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
  return reviewPurchasePriceCollisions({
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
    ...(summary.purchasePriceSelections
      ? { purchasePriceSelections: summary.purchasePriceSelections }
      : {}),
    ...(summary.publishedSourceIndexes
      ? { publishedSourceIndexes: summary.publishedSourceIndexes }
      : {}),
  });
}
export function validateMercalysImport(
  workbook: SpreadsheetWorkbook,
  storeId: string,
  catalog: ProductMatchCatalog,
  policy: MercalysMatchingPolicy = "CODES",
): MercalysImportValidationSummary {
  const { records, ...summary } = parseImport(workbook);
  const matcher =
    policy === "LEGACY"
      ? prepareProductMatcher(storeId, catalog)
      : prepareMercalysProductMatcher(storeId, catalog);
  return withMatches(
    summary,
    records.map((record) => matchRecord(record, storeId, catalog, matcher)),
  );
}
export function rematchMercalysImport(
  summary: MercalysImportValidationSummary,
  storeId: string,
  catalog: ProductMatchCatalog,
): MercalysImportValidationSummary {
  const matcher = prepareMercalysProductMatcher(storeId, catalog);
  return withMatches(
    summary,
    summary.lines.map(({ record }) =>
      matchRecord(record, storeId, catalog, matcher),
    ),
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
  previous?: {
    catalog: ProductMatchCatalog;
    lines: MercalysImportValidationLine[];
  },
  policy: MercalysMatchingPolicy = "CODES",
) {
  const incremental = previous;
  const lines: MercalysImportValidationLine[] = [];
  const matcher =
    policy === "LEGACY"
      ? prepareProductMatcher(storeId, catalog)
      : prepareMercalysProductMatcher(storeId, catalog);
  let sliceStarted = Date.now();
  for (let index = 0; index < records.length; index++) {
    if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
    if (
      index === 0 ||
      Date.now() - sliceStarted >= 8 ||
      (!incremental && index % 20 === 0)
    ) {
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
  policy: MercalysMatchingPolicy = "CODES",
) {
  if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
  const { records, ...summary } = parseImport(workbook);
  return withMatches(
    summary,
    await matchResponsive(
      records,
      storeId,
      catalog,
      signal,
      onProgress,
      undefined,
      policy,
    ),
  );
}
export async function rematchMercalysImportResponsive(
  summary: MercalysImportValidationSummary,
  storeId: string,
  catalog: ProductMatchCatalog,
  signal?: AbortSignal,
  onProgress?: (progress: MercalysMatchingProgress) => void,
  previousCatalog?: ProductMatchCatalog,
) {
  return withMatches(
    summary,
    await matchResponsive(
      summary.lines.map(({ record }) => record),
      storeId,
      catalog,
      signal,
      onProgress,
      previousCatalog
        ? { catalog: previousCatalog, lines: summary.lines }
        : undefined,
    ),
  );
}

export function updateMercalysResolvedLines(
  summary: MercalysImportValidationSummary,
  storeId: string,
  catalog: ProductMatchCatalog,
  sourceIndexes: readonly number[],
) {
  const selected = new Set(sourceIndexes);
  const matcher = prepareMercalysProductMatcher(storeId, catalog);
  return withMatches(
    summary,
    summary.lines.map((line) =>
      selected.has(line.record.sourceIndex)
        ? matchRecord(line.record, storeId, catalog, matcher)
        : line,
    ),
  );
}
