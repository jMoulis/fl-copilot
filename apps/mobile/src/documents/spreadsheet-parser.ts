export type SpreadsheetCellKind =
  "STRING" | "NUMBER" | "BOOLEAN" | "DATE" | "ERROR" | "EMPTY";

export interface SpreadsheetCell {
  kind: SpreadsheetCellKind;
  value: string | number | boolean | Date | null;
  formattedValue: string | null;
  numberFormat: string | null;
  formula: string | null;
}

export interface SpreadsheetSheet {
  name: string;
  rows: SpreadsheetCell[][];
  rowCount: number;
  columnCount: number;
  empty: boolean;
}

export interface SpreadsheetWorkbook {
  sheets: SpreadsheetSheet[];
}

export interface LocalSpreadsheetParser {
  parse(data: ArrayBuffer | Uint8Array): SpreadsheetWorkbook;
}
