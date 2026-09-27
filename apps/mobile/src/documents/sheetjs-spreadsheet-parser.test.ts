import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  SheetJsSpreadsheetParser,
  XLSX_ADAPTER_VERSION,
} from "./sheetjs-spreadsheet-parser";

function characterizationWorkbook() {
  const workbook = XLSX.utils.book_new();
  const sales = XLSX.utils.aoa_to_sheet([
    ["Rapport ventes nettes Mercalys"],
    ["Rapport généré le", new Date("2026-09-16T00:00:00.000Z")],
    ["Période sélectionnée", "15/04/2024"],
    [],
    [
      "ITM8 Prio",
      "EAN Prio",
      "Libellé",
      "Date",
      "Quantité",
      "Valeur prix vente",
    ],
    [
      1234,
      87003017,
      "Poire conférence vrac",
      new Date("2024-04-15"),
      2.5,
      1.14,
    ],
    ["00005678", "0000000003017", "Pomme gala", "15/04/2024", "1,25", "3,75"],
    [null, null, "TOTAL", null, 3.75, 4.89],
  ]);
  if (!sales.A6 || !sales.B6) throw new Error("Fixture cells are missing.");
  sales.A6.z = "00000000";
  sales.B6.z = "0000000000000";
  XLSX.utils.book_append_sheet(workbook, sales, "Ventes");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Vide");
  return workbook;
}

function workbookBytes(workbook = characterizationWorkbook()) {
  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
}

describe(`SheetJS spreadsheet adapter ${XLSX_ADAPTER_VERSION}`, () => {
  it("preserves metadata, business dates, decimal forms, totals, and empty sheets", () => {
    const result = new SheetJsSpreadsheetParser().parse(workbookBytes());

    expect(result.sheets.map(({ name }) => name)).toEqual(["Ventes", "Vide"]);
    const sales = result.sheets[0];
    expect(sales).toMatchObject({ rowCount: 8, columnCount: 6, empty: false });
    expect(sales?.rows[0]?.[0]).toMatchObject({
      kind: "STRING",
      value: "Rapport ventes nettes Mercalys",
    });
    expect(sales?.rows[1]?.[1]?.value).toBeInstanceOf(Date);
    expect(sales?.rows[2]?.[1]?.value).toBe("15/04/2024");
    expect(sales?.rows[5]?.[3]?.value).toBeInstanceOf(Date);
    expect(sales?.rows[5]?.[4]?.value).toBe(2.5);
    expect(sales?.rows[5]?.[5]?.value).toBe(1.14);
    expect(sales?.rows[6]?.[4]?.value).toBe("1,25");
    expect(sales?.rows[7]?.[2]?.value).toBe("TOTAL");
    expect(result.sheets[1]).toEqual({
      name: "Vide",
      rows: [],
      rowCount: 0,
      columnCount: 0,
      empty: true,
    });
  });

  it("keeps identifier display text so leading zeroes survive numeric Excel cells", () => {
    const result = new SheetJsSpreadsheetParser().parse(workbookBytes());
    const numericRow = result.sheets[0]?.rows[5];
    const textRow = result.sheets[0]?.rows[6];

    expect(numericRow?.[0]).toMatchObject({
      kind: "NUMBER",
      value: 1234,
      formattedValue: "00001234",
      numberFormat: "00000000",
    });
    expect(numericRow?.[1]).toMatchObject({
      kind: "NUMBER",
      value: 87003017,
      formattedValue: "0000087003017",
      numberFormat: "0000000000000",
    });
    expect(textRow?.[0]).toMatchObject({
      kind: "STRING",
      value: "00005678",
    });
    expect(textRow?.[1]).toMatchObject({
      kind: "STRING",
      value: "0000000003017",
    });
  });

  it("characterizes heap growth on a pilot-sized 10,000-row workbook", () => {
    const rows: unknown[][] = [["ITM8 Prio", "Libellé", "Date", "Valeur"]];
    for (let index = 0; index < 10_000; index += 1) {
      rows.push([
        String(index).padStart(8, "0"),
        `Produit ${index}`,
        "15/04/2024",
        index / 100,
      ]);
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      "Ventes",
    );
    const bytes = workbookBytes(workbook);
    const heapBefore = process.memoryUsage().heapUsed;

    const parsed = new SheetJsSpreadsheetParser().parse(bytes);
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

    expect(parsed.sheets[0]?.rowCount).toBe(10_001);
    expect(heapGrowth).toBeLessThan(192 * 1024 * 1024);
  });
});
