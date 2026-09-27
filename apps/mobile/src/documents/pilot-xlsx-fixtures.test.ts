import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";

const fixtureDirectory = resolve(process.cwd(), "docs/files_examples");
const fixtureNames = existsSync(fixtureDirectory)
  ? readdirSync(fixtureDirectory)
      .filter((name) => name.toLowerCase().endsWith(".xlsx"))
      .sort()
  : [];

describe.skipIf(fixtureNames.length === 0)("local pilot XLSX fixtures", () => {
  it("reads every available monthly export within the workstation memory budget", () => {
    expect(fixtureNames).toEqual([
      "08-2025.xlsx",
      "08_2026.xlsx",
      "09-2025.xlsx",
      "10_2025.xlsx",
      "11_2025.xlsx",
      "12_2025.xlsx",
    ]);
    const parser = new SheetJsSpreadsheetParser();
    const heapBefore = process.memoryUsage().heapUsed;

    for (const fixtureName of fixtureNames) {
      const bytes = readFileSync(resolve(fixtureDirectory, fixtureName));
      const workbook = parser.parse(bytes);
      expect(workbook.sheets).toHaveLength(3);
      expect(workbook.sheets.filter((sheet) => sheet.empty)).toHaveLength(2);

      const populatedSheet = workbook.sheets.find((sheet) => !sheet.empty);
      expect(populatedSheet?.rowCount).toBeGreaterThan(250);
      expect(populatedSheet?.columnCount).toBe(6);
      expect(populatedSheet?.rows[0]?.map((cell) => cell.value)).toEqual([
        "Libellé",
        "Année/Mois",
        "Quantité",
        "Valeur prix vente",
        "Val Marge",
        "% Marge",
      ]);
      expect(populatedSheet?.rows[1]?.[1]?.value).toMatch(/^\d{4}\/\d{2}$/);
      expect(
        populatedSheet?.rows
          .flat()
          .some(
            (cell) =>
              cell.kind === "NUMBER" &&
              typeof cell.value === "number" &&
              !Number.isInteger(cell.value),
          ),
      ).toBe(true);
    }

    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    expect(heapGrowth).toBeLessThan(64 * 1024 * 1024);
  });
});
