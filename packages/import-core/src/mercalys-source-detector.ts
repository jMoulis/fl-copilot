import type { SourceType } from "@fl-copilot/domain";
import type {
  SpreadsheetCell,
  SpreadsheetWorkbook,
} from "./spreadsheet-parser";

export type MercalysSourceType = Extract<
  SourceType,
  "MERCALYS_SALES" | "MERCALYS_WASTE"
>;

export type MercalysGranularity =
  "DAILY_ROWS" | "SINGLE_DAY" | "AGGREGATED_PERIOD" | "UNKNOWN";

export type MercalysDetectionReason =
  | "CONFLICTING_FLOW_MARKERS"
  | "MISSING_REPORT_CONTEXT"
  | "MISSING_REQUIRED_COLUMNS"
  | "MISSING_SELECTION_PERIOD"
  | "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"
  | "UNRECOGNIZED_WORKBOOK";

interface MercalysDetectionBase {
  confidence: number;
  formatVersion: string | null;
  granularity: MercalysGranularity;
  sheetName: string | null;
  headerRowIndex: number | null;
  selectionPeriodText: string | null;
  businessDate: string | null;
  reasons: MercalysDetectionReason[];
}

export type MercalysSourceDetection =
  | (MercalysDetectionBase & {
      status: "DETECTED";
      sourceType: MercalysSourceType;
    })
  | (MercalysDetectionBase & {
      status: "AMBIGUOUS";
      sourceType: null;
    })
  | (MercalysDetectionBase & {
      status: "UNSUPPORTED";
      sourceType: MercalysSourceType | null;
    });

const MAX_DETECTION_ROWS_PER_SHEET = 200;
const MAX_DETECTION_COLUMNS_PER_ROW = 64;
const REPORT_FORMAT_VERSION = "mercalys-entries-outputs.article.v1";
const REQUIRED_ARTICLE_HEADERS = [
  "ITM8 PRIO",
  "EAN PRIO",
  "LIBELLE",
  "QUANTITE",
  "VALEUR PRIX ACHAT",
  "VALEUR RCE",
  "VALEUR PRIX VENTE",
  "VALEUR TVA",
  "VAL MARGE",
  "MARGE",
] as const;

interface SemanticRow {
  sheetName: string;
  rowIndex: number;
  cells: string[];
  text: string;
  rawText: string;
}

interface SelectionPeriod {
  granularity: "SINGLE_DAY" | "AGGREGATED_PERIOD" | "UNKNOWN";
  businessDate: string | null;
}

export function detectMercalysSource(
  workbook: SpreadsheetWorkbook,
): MercalysSourceDetection {
  const rows = semanticRows(workbook);
  const salesFluxRows = rows.filter((row) =>
    row.text.includes("FLUX VENTE NETTE"),
  );
  const wasteFluxRows = rows.filter((row) => row.text.includes("FLUX CASSE"));

  if (salesFluxRows.length > 0 && wasteFluxRows.length > 0) {
    return unsupportedDetection({
      status: "AMBIGUOUS",
      sourceType: null,
      reason: "CONFLICTING_FLOW_MARKERS",
    });
  }

  const sourceType = salesFluxRows.length
    ? "MERCALYS_SALES"
    : wasteFluxRows.length
      ? "MERCALYS_WASTE"
      : null;
  const fluxRow = salesFluxRows[0] ?? wasteFluxRows[0];
  if (!sourceType || !fluxRow) {
    return unsupportedDetection({
      status: "UNSUPPORTED",
      sourceType: null,
      reason: "UNRECOGNIZED_WORKBOOK",
    });
  }

  const sheetRows = rows.filter((row) => row.sheetName === fluxRow.sheetName);
  const reportText = sheetRows.map((row) => row.text).join(" ");
  if (
    !reportText.includes("STATISTIQUE ENTREES SORTIES") ||
    !reportText.includes("NIVEAU DE DETAIL PAR ARTICLE")
  ) {
    return unsupportedDetection({
      status: "UNSUPPORTED",
      sourceType,
      reason: "MISSING_REPORT_CONTEXT",
      sheetName: fluxRow.sheetName,
    });
  }

  const headerRow = sheetRows.find(isArticleHeader);
  if (!headerRow) {
    return unsupportedDetection({
      status: "UNSUPPORTED",
      sourceType,
      reason: "MISSING_REQUIRED_COLUMNS",
      sheetName: fluxRow.sheetName,
    });
  }

  const selectionRow = sheetRows.find((row) =>
    row.text.includes("SELECTION DE DONNEES"),
  );
  if (!selectionRow) {
    return unsupportedDetection({
      status: "UNSUPPORTED",
      sourceType,
      reason: "MISSING_SELECTION_PERIOD",
      sheetName: fluxRow.sheetName,
      headerRowIndex: headerRow.rowIndex,
    });
  }

  const hasDailyRows =
    reportText.includes("DETAIL PERIODE PAR JOUR") &&
    headerRow.cells.includes("DATE");
  const selection = parseSelectionPeriod(selectionRow.text);
  if (!hasDailyRows && selection.granularity !== "SINGLE_DAY") {
    return unsupportedDetection({
      status: "UNSUPPORTED",
      sourceType,
      reason: "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES",
      sheetName: fluxRow.sheetName,
      headerRowIndex: headerRow.rowIndex,
      selectionPeriodText: selectionRow.rawText,
      granularity: selection.granularity,
    });
  }

  return {
    status: "DETECTED",
    sourceType,
    confidence: 1,
    formatVersion: REPORT_FORMAT_VERSION,
    granularity: hasDailyRows ? "DAILY_ROWS" : "SINGLE_DAY",
    sheetName: fluxRow.sheetName,
    headerRowIndex: headerRow.rowIndex,
    selectionPeriodText: selectionRow.rawText,
    businessDate: hasDailyRows ? null : selection.businessDate,
    reasons: [],
  };
}

function unsupportedDetection(input: {
  status: "AMBIGUOUS" | "UNSUPPORTED";
  sourceType: MercalysSourceType | null;
  reason: MercalysDetectionReason;
  sheetName?: string;
  headerRowIndex?: number;
  selectionPeriodText?: string;
  granularity?: MercalysGranularity;
}): MercalysSourceDetection {
  const base: MercalysDetectionBase = {
    confidence: input.sourceType ? 0.95 : 0,
    formatVersion: null,
    granularity: input.granularity ?? "UNKNOWN",
    sheetName: input.sheetName ?? null,
    headerRowIndex: input.headerRowIndex ?? null,
    selectionPeriodText: input.selectionPeriodText ?? null,
    businessDate: null,
    reasons: [input.reason],
  };
  if (input.status === "AMBIGUOUS") {
    return { ...base, status: "AMBIGUOUS", sourceType: null };
  }
  return { ...base, status: "UNSUPPORTED", sourceType: input.sourceType };
}

function semanticRows(workbook: SpreadsheetWorkbook): SemanticRow[] {
  return workbook.sheets.flatMap((sheet) =>
    sheet.rows.slice(0, MAX_DETECTION_ROWS_PER_SHEET).map((row, rowIndex) => {
      const sourceCells = row.slice(0, MAX_DETECTION_COLUMNS_PER_ROW);
      const cells = sourceCells.map(cellText).filter(Boolean);
      return {
        sheetName: sheet.name,
        rowIndex,
        cells,
        text: cells.join(" "),
        rawText: sourceCells.map(rawCellText).filter(Boolean).join(" "),
      };
    }),
  );
}

function isArticleHeader(row: SemanticRow) {
  const values = new Set(row.cells);
  return REQUIRED_ARTICLE_HEADERS.every((header) => values.has(header));
}

function parseSelectionPeriod(text: string): SelectionPeriod {
  const dateRange = text.match(
    /\bDU (\d{1,2}) (\d{1,2}) (\d{4}) AU (\d{1,2}) (\d{1,2}) (\d{4})\b/,
  );
  if (dateRange) {
    const start = isoDate(dateRange[1], dateRange[2], dateRange[3]);
    const end = isoDate(dateRange[4], dateRange[5], dateRange[6]);
    if (start && start === end) {
      return { granularity: "SINGLE_DAY", businessDate: start };
    }
    return { granularity: "AGGREGATED_PERIOD", businessDate: null };
  }

  if (/\bDU \d{1,2} \d{4} AU \d{1,2} \d{4}\b/.test(text)) {
    return { granularity: "AGGREGATED_PERIOD", businessDate: null };
  }
  return { granularity: "UNKNOWN", businessDate: null };
}

function isoDate(
  dayText: string | undefined,
  monthText: string | undefined,
  yearText: string | undefined,
) {
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function rawCellText(cell: SpreadsheetCell) {
  return typeof cell.value === "string" ? cell.value.trim() : "";
}

function cellText(cell: SpreadsheetCell) {
  return normalizeSemanticText(rawCellText(cell));
}

export function normalizeSemanticText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("fr-FR")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
