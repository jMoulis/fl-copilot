import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";

const fixtureDirectory = resolve(process.cwd(), "docs/files_examples");
const fixtureNames = existsSync(fixtureDirectory)
  ? readdirSync(fixtureDirectory)
      .filter(
        (name) =>
          !name.startsWith("~$") && name.toLowerCase().endsWith(".xlsx"),
      )
      .sort()
  : [];

describe.skipIf(fixtureNames.length === 0)("local pilot XLSX fixtures", () => {
  it("reads the available Mercalys exports within the workstation memory budget", () => {
    expect(fixtureNames).toEqual([
      "39_2026.xlsx",
      "casse_39_2026.xlsx",
      "casse_day_example.xlsx",
      "ventes_day_example.xlsx",
    ]);
    const parser = new SheetJsSpreadsheetParser();
    const heapBefore = process.memoryUsage().heapUsed;

    for (const fixtureName of fixtureNames) {
      const bytes = readFileSync(resolve(fixtureDirectory, fixtureName));
      const workbook = parser.parse(bytes);
      expect(workbook.sheets.length).toBeGreaterThanOrEqual(1);

      const populatedSheet = workbook.sheets.find((sheet) => !sheet.empty);
      expect(populatedSheet?.name).toBe("Mercalys");
      expect(populatedSheet?.rowCount).toBeGreaterThan(30);
      expect(populatedSheet?.columnCount).toBe(10);
      expect(populatedSheet?.rows[7]?.map((cell) => cell.value)).toEqual([
        "ITM8 Prio",
        "EAN Prio",
        "Libellé",
        "Quantité",
        "Valeur prix achat",
        "Valeur RCE",
        "Valeur prix vente",
        "Valeur TVA",
        "Val Marge",
        "% Marge",
      ]);
      expect(populatedSheet?.rows[8]?.[0]?.value).toEqual(expect.any(String));
      expect(populatedSheet?.rows[8]?.[1]?.value).toEqual(expect.any(String));
      expect(
        populatedSheet?.rows
          .slice(8)
          .flatMap((row) => row.slice(0, 2))
          .some(
            (cell) =>
              typeof cell.value === "string" && /^0\d+$/.test(cell.value),
          ),
      ).toBe(true);
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
