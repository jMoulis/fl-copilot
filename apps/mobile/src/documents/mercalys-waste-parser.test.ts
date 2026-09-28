import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";
import {
  MercalysWasteParseError,
  parseMercalysWaste,
} from "./mercalys-waste-parser";

const spreadsheetParser = new SheetJsSpreadsheetParser();
const expectedGolden = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "apps/mobile/src/documents/__fixtures__/mercalys-waste-daily-v1.expected.json",
    ),
    "utf8",
  ),
);

describe("parseMercalysWaste", () => {
  it("matches the anonymized daily golden result", () => {
    expect(parseMercalysWaste(goldenWorkbook())).toEqual(expectedGolden);
  });

  it("rejects sales and aggregated weekly waste reports", () => {
    expect(() =>
      parseMercalysWaste(workbook([], { flow: "Vente Nette" })),
    ).toThrowError(
      expect.objectContaining<Partial<MercalysWasteParseError>>({
        code: "MERCALYS_SOURCE_TYPE_MISMATCH",
      }),
    );
    expect(() =>
      parseMercalysWaste(workbook([], { selection: "Du 39/2026 Au 39/2026" })),
    ).toThrowError(
      expect.objectContaining<Partial<MercalysWasteParseError>>({
        code: "MERCALYS_WASTE_FORMAT_UNSUPPORTED",
      }),
    );
  });
});

const localWasteFixture = resolve(
  process.cwd(),
  "docs/files_examples/casse_day_example.xlsx",
);

describe.skipIf(!existsSync(localWasteFixture))(
  "real daily Mercalys waste fixture",
  () => {
    it("normalizes all article rows and excludes the total row", () => {
      const result = parseMercalysWaste(
        spreadsheetParser.parse(readFileSync(localWasteFixture)),
      );

      expect(result.records).toHaveLength(27);
      expect(result.declaredLineCount).toBe(27);
      expect(result.businessPeriodStart).toBe("2026-09-26");
      expect(result.businessPeriodEnd).toBe("2026-09-26");
      expect(result.records[0]).toMatchObject({
        itm8: "0000087010621",
        ean: "3250399883471",
        businessDate: "2026-09-26",
        quantity: 3,
        purchaseValue: 8.25,
      });
      expect(result.controlTotals).toMatchObject({
        quantity: 68,
        purchaseValue: 145.23,
        salesValue: 260.5,
      });
      expect(result.issues).toEqual([]);
    });
  },
);

function goldenWorkbook() {
  return workbook(
    [
      [
        "0000087010621",
        "3250399883471",
        "PDT VAPEUR BLONDE 2.5KG ITM",
        3,
        8.25,
        0,
        14.13,
        0.74,
        5.14,
        36.4,
      ],
      [
        "0000087010680",
        "3250399887516",
        "CHAMPIGNON PLEUROTE 200G ITM",
        "3,00",
        "5,97",
        "0",
        "10,59",
        "0,55",
        "4,07",
        "38,41",
      ],
    ],
    {
      total: ["", "", "", 6, 14.22, 0, 24.72, 1.29, 9.21, 37.26],
      lineCount: 2,
    },
  );
}

function workbook(
  articleRows: unknown[][],
  options: {
    flow?: "Vente Nette" | "Casse";
    selection?: string;
    total?: unknown[];
    lineCount?: number;
  } = {},
) {
  const rows = [
    ["PDV: 00000 - MAGASIN TEST Date : 28/09/2026 Heure : 19:42:46"],
    [
      `Statistique : Entrées / Sorties: Niveau de détail: Par Article, Détail Période: non détaillée, Flux: ${options.flow ?? "Casse"}, Type valorisation: PA`,
    ],
    [],
    [
      `Sélection de données : Du ${options.selection?.replace(/^Du /, "") ?? "26/09/2026 Au 26/09/2026"}`,
    ],
    ["Critères de sélection :"],
    ["Nomenclature : Du 20343400 à 20343402"],
    [],
    [
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
    ],
    ...articleRows,
  ];
  if (options.total) rows.push(options.total);
  rows.push(
    [],
    [],
    [`Nombre de Lignes : ${options.lineCount ?? articleRows.length}`],
  );

  const xlsxWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    xlsxWorkbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Mercalys",
  );
  XLSX.utils.book_append_sheet(
    xlsxWorkbook,
    XLSX.utils.aoa_to_sheet([]),
    "Feuil2",
  );
  return spreadsheetParser.parse(
    XLSX.write(xlsxWorkbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer,
  );
}
