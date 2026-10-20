import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";
// The workbook decoder is separate from our object allocation; sparse malicious !ref
// metadata must be refused before allocating even the first output sheet.
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, read: vi.fn() };
});
function workbook(refs: string[]) {
  vi.mocked(XLSX.read).mockReturnValue({
    SheetNames: refs.map((_, i) => `sheet-${i}`),
    Sheets: Object.fromEntries(
      refs.map((ref, i) => [
        `sheet-${i}`,
        { "!ref": ref, A1: { t: "s", v: "test" } },
      ]),
    ),
  });
}
it("rejects a huge sparse rectangle within the individual row and column limits", () => {
  workbook(["A1:SR100000"]);
  expect(() =>
    new SheetJsSpreadsheetParser().parse(new Uint8Array([1])),
  ).toThrow("XLSX_CELL_LIMIT_EXCEEDED");
});
it("counts the entire workbook before materializing any output sheet", () => {
  workbook(["A1:K100000", "A1:K100000"]);
  expect(() =>
    new SheetJsSpreadsheetParser().parse(new Uint8Array([1])),
  ).toThrow("XLSX_CELL_LIMIT_EXCEEDED");
});
it("keeps ordinary worksheets and their typed/formatted content", () => {
  workbook(["A1:K2", "A1:B2"]);
  const result = new SheetJsSpreadsheetParser().parse(new Uint8Array([1]));
  expect(result.sheets.map((s) => [s.rowCount, s.columnCount])).toEqual([
    [2, 11],
    [2, 2],
  ]);
  expect(result.sheets[0]?.rows[0]?.[0]).toMatchObject({
    kind: "STRING",
    value: "test",
  });
});
