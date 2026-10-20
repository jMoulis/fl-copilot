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
// Row and column bounds alone still permit 51.2 million allocated cell objects.
// Keep ordinary annual Mercalys exports (100k rows × 11 columns) within the budget.
export const MAX_XLSX_CELLS_PER_WORKBOOK = 2_000_000;

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

    const shapes = workbook.SheetNames.map((name) =>
      sheetShape(name, workbook.Sheets[name]),
    );
    let cells = 0;
    for (const shape of shapes) {
      cells += shape.rowCount * shape.columnCount;
      if (cells > MAX_XLSX_CELLS_PER_WORKBOOK)
        throw Error("XLSX_CELL_LIMIT_EXCEEDED");
    }
    return {
      sheets: workbook.SheetNames.map((name) =>
        mapSheet(name, workbook.Sheets[name]),
      ),
    };
  }
}

function sheetShape(
  name: string,
  worksheet: XLSX.WorkSheet | XLSX.DenseWorkSheet | undefined,
) {
  const reference = worksheet?.["!ref"];
  if (!worksheet || typeof reference !== "string")
    return { rowCount: 0, columnCount: 0 };
  const range = XLSX.utils.decode_range(reference);
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  if (
    ![range.s.r, range.s.c, range.e.r, range.e.c, rowCount, columnCount].every(
      Number.isSafeInteger,
    ) ||
    range.s.r < 0 ||
    range.s.c < 0 ||
    rowCount < 1 ||
    columnCount < 1
  )
    throw Error("XLSX_RANGE_INVALID");
  if (rowCount > MAX_XLSX_ROWS_PER_SHEET)
    throw Error(
      `XLSX_ROW_LIMIT_EXCEEDED:${name}:${rowCount}:${MAX_XLSX_ROWS_PER_SHEET}`,
    );
  if (columnCount > MAX_XLSX_COLUMNS_PER_SHEET)
    throw Error(
      `XLSX_COLUMN_LIMIT_EXCEEDED:${name}:${columnCount}:${MAX_XLSX_COLUMNS_PER_SHEET}`,
    );
  return { rowCount, columnCount };
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
  const { rowCount, columnCount } = sheetShape(name, worksheet);

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
