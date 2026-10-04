import * as XLSX from "xlsx";
import type {
  LocalSpreadsheetParser,
  SpreadsheetCell,
  SpreadsheetCellKind,
  SpreadsheetSheet,
  SpreadsheetWorkbook,
} from "./spreadsheet-parser";

export const XLSX_ADAPTER_VERSION = "sheetjs-ce-0.20.3-spike-1";
export const MAX_XLSX_ROWS_PER_SHEET = 100_000;
export const MAX_XLSX_COLUMNS_PER_SHEET = 512;

export class SheetJsSpreadsheetParser implements LocalSpreadsheetParser {
  parse(data: ArrayBuffer | Uint8Array): SpreadsheetWorkbook {
    const workbook = XLSX.read(data, {
      type: "array",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      dense: true,
      WTF: false,
    });

    return {
      sheets: workbook.SheetNames.map((name) =>
        mapSheet(name, workbook.Sheets[name]),
      ),
    };
  }
}

function mapSheet(
  name: string,
  worksheet: XLSX.WorkSheet | XLSX.DenseWorkSheet | undefined,
): SpreadsheetSheet {
  const reference = worksheet?.["!ref"];
  if (!worksheet || typeof reference !== "string") {
    return {
      name,
      rows: [],
      rowCount: 0,
      columnCount: 0,
      empty: true,
    };
  }

  const range = XLSX.utils.decode_range(reference);
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  if (rowCount > MAX_XLSX_ROWS_PER_SHEET) {
    throw new Error(
      `XLSX_ROW_LIMIT_EXCEEDED:${name}:${rowCount}:${MAX_XLSX_ROWS_PER_SHEET}`,
    );
  }
  if (columnCount > MAX_XLSX_COLUMNS_PER_SHEET) {
    throw new Error(
      `XLSX_COLUMN_LIMIT_EXCEEDED:${name}:${columnCount}:${MAX_XLSX_COLUMNS_PER_SHEET}`,
    );
  }

  const denseData = (worksheet as XLSX.DenseWorkSheet)["!data"];
  const rows = Array.from({ length: rowCount }, (_, rowOffset) =>
    Array.from({ length: columnCount }, (_, columnOffset) => {
      const rowIndex = range.s.r + rowOffset;
      const columnIndex = range.s.c + columnOffset;
      const cell = Array.isArray(denseData)
        ? denseData[rowIndex]?.[columnIndex]
        : worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      return mapCell(cell as XLSX.CellObject | undefined);
    }),
  );

  return {
    name,
    rows,
    rowCount,
    columnCount,
    empty: rows.every((row) => row.every((cell) => cell.kind === "EMPTY")),
  };
}

function mapCell(cell: XLSX.CellObject | undefined): SpreadsheetCell {
  if (!cell || cell.v === undefined || cell.t === "z") {
    return {
      kind: "EMPTY",
      value: null,
      formattedValue: null,
      numberFormat: null,
      formula: null,
    };
  }

  return {
    kind: cellKind(cell),
    value: cell.v,
    formattedValue: cell.w ?? null,
    numberFormat: cell.z ? String(cell.z) : null,
    formula: cell.f ?? null,
  };
}

function cellKind(cell: XLSX.CellObject): SpreadsheetCellKind {
  if (cell.v instanceof Date || cell.t === "d") return "DATE";
  if (cell.t === "s") return "STRING";
  if (cell.t === "n") return "NUMBER";
  if (cell.t === "b") return "BOOLEAN";
  if (cell.t === "e") return "ERROR";
  return "EMPTY";
}
