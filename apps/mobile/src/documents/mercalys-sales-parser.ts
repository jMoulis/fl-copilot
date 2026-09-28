import {
  detectMercalysSource,
  normalizeSemanticText,
} from "./mercalys-source-detector";
import type {
  SpreadsheetCell,
  SpreadsheetSheet,
  SpreadsheetWorkbook,
} from "./spreadsheet-parser";

export const MERCALYS_SALES_PARSER_VERSION = "mercalys-sales.article.v1";

const FIELD_HEADERS = {
  itm8: "ITM8 PRIO",
  ean: "EAN PRIO",
  rawLabel: "LIBELLE",
  businessDate: "DATE",
  quantity: "QUANTITE",
  purchaseValue: "VALEUR PRIX ACHAT",
  rceValue: "VALEUR RCE",
  salesValue: "VALEUR PRIX VENTE",
  vatValue: "VALEUR TVA",
  marginValue: "VAL MARGE",
  marginRate: "MARGE",
} as const;

type MercalysSalesField = keyof typeof FIELD_HEADERS;
type RawMercalysValue = string | number | boolean | null;

export interface ParsedMercalysSalesRecord {
  sourceIndex: number;
  itm8: string | null;
  ean: string | null;
  rawLabel: string;
  businessDate: string;
  quantity: number;
  purchaseValue: number | null;
  rceValue: number | null;
  salesValue: number | null;
  vatValue: number | null;
  marginValue: number | null;
  marginRate: number | null;
  rawValues: Record<MercalysSalesField, RawMercalysValue>;
}

export interface MercalysSalesControlTotals {
  quantity: number | null;
  purchaseValue: number | null;
  rceValue: number | null;
  salesValue: number | null;
  vatValue: number | null;
  marginValue: number | null;
  marginRate: number | null;
}

export type MercalysSalesParseIssueCode =
  | "MISSING_LABEL"
  | "INVALID_IDENTIFIER"
  | "INVALID_BUSINESS_DATE"
  | "INVALID_QUANTITY"
  | "UNPARSEABLE_NUMERIC_VALUE"
  | "DECLARED_LINE_COUNT_MISMATCH";

export interface MercalysSalesParseIssue {
  code: MercalysSalesParseIssueCode;
  sourceIndex: number | null;
  field: MercalysSalesField | null;
}

export interface MercalysSalesParseResult {
  sourceType: "MERCALYS_SALES";
  parserVersion: typeof MERCALYS_SALES_PARSER_VERSION;
  formatVersion: string;
  sheetName: string;
  headerRowIndex: number;
  businessPeriodStart: string;
  businessPeriodEnd: string;
  records: ParsedMercalysSalesRecord[];
  controlTotals: MercalysSalesControlTotals | null;
  declaredLineCount: number | null;
  issues: MercalysSalesParseIssue[];
}

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
  const detection = detectMercalysSource(workbook);
  if (detection.sourceType && detection.sourceType !== "MERCALYS_SALES") {
    throw new MercalysSalesParseError("MERCALYS_SOURCE_TYPE_MISMATCH");
  }
  if (
    detection.status !== "DETECTED" ||
    detection.sourceType !== "MERCALYS_SALES" ||
    !detection.formatVersion ||
    !detection.sheetName ||
    detection.headerRowIndex === null
  ) {
    throw new MercalysSalesParseError("MERCALYS_SALES_FORMAT_UNSUPPORTED");
  }

  const sheet = workbook.sheets.find(
    (candidate) => candidate.name === detection.sheetName,
  );
  if (!sheet) {
    throw new MercalysSalesParseError("MERCALYS_SALES_SHEET_MISSING");
  }

  const indexes = headerIndexes(sheet, detection.headerRowIndex);
  const records: ParsedMercalysSalesRecord[] = [];
  const issues: MercalysSalesParseIssue[] = [];
  let controlTotals: MercalysSalesControlTotals | null = null;
  let declaredLineCount: number | null = null;

  for (
    let sourceIndex = detection.headerRowIndex + 1;
    sourceIndex < sheet.rows.length;
    sourceIndex += 1
  ) {
    const row = sheet.rows[sourceIndex];
    if (!row || row.every((cell) => cell.kind === "EMPTY")) continue;

    const lineCount = parseLineCount(row);
    if (lineCount !== null) {
      declaredLineCount = lineCount;
      continue;
    }
    if (isControlTotalRow(row, indexes)) {
      controlTotals = parseControlTotals(row, indexes);
      continue;
    }

    const parsed = parseArticleRow(
      row,
      sourceIndex,
      indexes,
      detection.businessDate,
    );
    if (parsed.record) records.push(parsed.record);
    issues.push(...parsed.issues);
  }

  if (declaredLineCount !== null && declaredLineCount !== records.length) {
    issues.push({
      code: "DECLARED_LINE_COUNT_MISMATCH",
      sourceIndex: null,
      field: null,
    });
  }

  const dates = records.map((record) => record.businessDate).sort();
  const periodStart = dates[0] ?? detection.businessDate;
  const periodEnd = dates.at(-1) ?? detection.businessDate;
  if (!periodStart || !periodEnd) {
    throw new MercalysSalesParseError("MERCALYS_SALES_FORMAT_UNSUPPORTED");
  }

  return {
    sourceType: "MERCALYS_SALES",
    parserVersion: MERCALYS_SALES_PARSER_VERSION,
    formatVersion: detection.formatVersion,
    sheetName: detection.sheetName,
    headerRowIndex: detection.headerRowIndex,
    businessPeriodStart: periodStart,
    businessPeriodEnd: periodEnd,
    records,
    controlTotals,
    declaredLineCount,
    issues,
  };
}

type HeaderIndexes = Partial<Record<MercalysSalesField, number>>;

function headerIndexes(sheet: SpreadsheetSheet, headerRowIndex: number) {
  const row = sheet.rows[headerRowIndex] ?? [];
  const normalizedHeaders = row.map((cell) =>
    normalizeSemanticText(cellString(cell) ?? ""),
  );
  return Object.fromEntries(
    Object.entries(FIELD_HEADERS).flatMap(([field, header]) => {
      const index = normalizedHeaders.indexOf(header);
      return index === -1 ? [] : [[field, index]];
    }),
  ) as HeaderIndexes;
}

function parseArticleRow(
  row: SpreadsheetCell[],
  sourceIndex: number,
  indexes: HeaderIndexes,
  fallbackBusinessDate: string | null,
) {
  const rowIssues: MercalysSalesParseIssue[] = [];
  const itm8 = parseIdentifier(cellAt(row, indexes.itm8));
  const ean = parseIdentifier(cellAt(row, indexes.ean));
  if (itm8 === "INVALID" || ean === "INVALID") {
    rowIssues.push({
      code: "INVALID_IDENTIFIER",
      sourceIndex,
      field: itm8 === "INVALID" ? "itm8" : "ean",
    });
  }

  const rawLabel = cellString(cellAt(row, indexes.rawLabel));
  if (!rawLabel) {
    rowIssues.push({ code: "MISSING_LABEL", sourceIndex, field: "rawLabel" });
  }

  const businessDate =
    indexes.businessDate === undefined
      ? fallbackBusinessDate
      : parseBusinessDate(cellAt(row, indexes.businessDate));
  if (!businessDate) {
    rowIssues.push({
      code: "INVALID_BUSINESS_DATE",
      sourceIndex,
      field: "businessDate",
    });
  }

  const numericFields = [
    "quantity",
    "purchaseValue",
    "rceValue",
    "salesValue",
    "vatValue",
    "marginValue",
    "marginRate",
  ] as const;
  const numbers = Object.fromEntries(
    numericFields.map((field) => [
      field,
      parseNumber(cellAt(row, indexes[field])),
    ]),
  ) as Record<(typeof numericFields)[number], number | null | "INVALID">;
  for (const field of numericFields) {
    if (numbers[field] === "INVALID") {
      rowIssues.push({
        code:
          field === "quantity"
            ? "INVALID_QUANTITY"
            : "UNPARSEABLE_NUMERIC_VALUE",
        sourceIndex,
        field,
      });
    }
  }
  if (numbers.quantity === null) {
    rowIssues.push({
      code: "INVALID_QUANTITY",
      sourceIndex,
      field: "quantity",
    });
  }

  if (
    rowIssues.length ||
    !rawLabel ||
    !businessDate ||
    numbers.quantity === null
  ) {
    return { record: null, issues: rowIssues };
  }

  return {
    record: {
      sourceIndex,
      itm8: itm8 === "INVALID" ? null : itm8,
      ean: ean === "INVALID" ? null : ean,
      rawLabel,
      businessDate,
      quantity: numbers.quantity as number,
      purchaseValue: validOptionalNumber(numbers.purchaseValue),
      rceValue: validOptionalNumber(numbers.rceValue),
      salesValue: validOptionalNumber(numbers.salesValue),
      vatValue: validOptionalNumber(numbers.vatValue),
      marginValue: validOptionalNumber(numbers.marginValue),
      marginRate: validOptionalNumber(numbers.marginRate),
      rawValues: rawValues(row, indexes),
    },
    issues: rowIssues,
  };
}

function rawValues(row: SpreadsheetCell[], indexes: HeaderIndexes) {
  return Object.fromEntries(
    Object.keys(FIELD_HEADERS).map((field) => {
      const typedField = field as MercalysSalesField;
      return [typedField, rawCellValue(cellAt(row, indexes[typedField]))];
    }),
  ) as Record<MercalysSalesField, RawMercalysValue>;
}

function rawCellValue(cell: SpreadsheetCell | undefined): RawMercalysValue {
  if (!cell || cell.value === null) return null;
  if (cell.value instanceof Date) {
    return cell.formattedValue ?? isoFromDate(cell.value);
  }
  return cell.value;
}

function isControlTotalRow(row: SpreadsheetCell[], indexes: HeaderIndexes) {
  const quantity = parseNumber(cellAt(row, indexes.quantity));
  const label = normalizeSemanticText(
    cellString(cellAt(row, indexes.rawLabel)) ?? "",
  );
  return (
    !cellHasValue(cellAt(row, indexes.itm8)) &&
    !cellHasValue(cellAt(row, indexes.ean)) &&
    (!label || label === "TOTAL") &&
    typeof quantity === "number"
  );
}

function parseControlTotals(
  row: SpreadsheetCell[],
  indexes: HeaderIndexes,
): MercalysSalesControlTotals {
  return {
    quantity: validOptionalNumber(parseNumber(cellAt(row, indexes.quantity))),
    purchaseValue: validOptionalNumber(
      parseNumber(cellAt(row, indexes.purchaseValue)),
    ),
    rceValue: validOptionalNumber(parseNumber(cellAt(row, indexes.rceValue))),
    salesValue: validOptionalNumber(
      parseNumber(cellAt(row, indexes.salesValue)),
    ),
    vatValue: validOptionalNumber(parseNumber(cellAt(row, indexes.vatValue))),
    marginValue: validOptionalNumber(
      parseNumber(cellAt(row, indexes.marginValue)),
    ),
    marginRate: validOptionalNumber(
      parseNumber(cellAt(row, indexes.marginRate)),
    ),
  };
}

function parseLineCount(row: SpreadsheetCell[]) {
  for (const cell of row) {
    const text = cellString(cell);
    const match = text
      ? normalizeSemanticText(text).match(/^NOMBRE DE LIGNES (\d+)$/)
      : null;
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function parseIdentifier(cell: SpreadsheetCell | undefined) {
  if (!cell || cell.value === null || cell.value === "") return null;
  const candidate =
    cell.kind === "NUMBER" && cell.formattedValue
      ? cell.formattedValue.trim()
      : String(cell.value).trim();
  return /^\d+$/.test(candidate) ? candidate : ("INVALID" as const);
}

function parseBusinessDate(cell: SpreadsheetCell | undefined) {
  if (!cell) return null;
  const formatted = cell.formattedValue
    ? parseDateText(cell.formattedValue)
    : null;
  if (formatted) return formatted;
  if (cell.value instanceof Date) return isoFromDate(cell.value);
  return typeof cell.value === "string" ? parseDateText(cell.value) : null;
}

function parseDateText(value: string) {
  const trimmed = value.trim();
  const frenchDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frenchDate)
    return validatedIsoDate(frenchDate[1], frenchDate[2], frenchDate[3]);
  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return validatedIsoDate(isoDate[3], isoDate[2], isoDate[1]);
  return null;
}

function validatedIsoDate(
  dayText: string | undefined,
  monthText: string | undefined,
  yearText: string | undefined,
) {
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoFromDate(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseNumber(cell: SpreadsheetCell | undefined) {
  if (!cell || cell.value === null || cell.value === "") return null;
  if (typeof cell.value === "number") {
    return Number.isFinite(cell.value) ? cell.value : ("INVALID" as const);
  }
  if (typeof cell.value !== "string") return "INVALID" as const;
  const compact = cell.value.replace(/[\s\u00a0\u202f]/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return "INVALID" as const;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : ("INVALID" as const);
}

function validOptionalNumber(value: number | null | "INVALID") {
  return typeof value === "number" ? value : null;
}

function cellAt(row: SpreadsheetCell[], index: number | undefined) {
  return index === undefined ? undefined : row[index];
}

function cellString(cell: SpreadsheetCell | undefined) {
  if (!cell || typeof cell.value !== "string") return null;
  const value = cell.value.trim();
  return value || null;
}

function cellHasValue(cell: SpreadsheetCell | undefined) {
  return Boolean(cell && cell.value !== null && cell.value !== "");
}
