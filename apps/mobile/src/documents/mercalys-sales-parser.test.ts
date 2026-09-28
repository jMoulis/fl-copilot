import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  MercalysSalesParseError,
  parseMercalysSales,
} from "./mercalys-sales-parser";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";

const spreadsheetParser = new SheetJsSpreadsheetParser();
const expectedGolden = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "apps/mobile/src/documents/__fixtures__/mercalys-sales-daily-v1.expected.json",
    ),
    "utf8",
  ),
);

describe("parseMercalysSales", () => {
  it("matches the anonymized daily golden result", () => {
    expect(parseMercalysSales(goldenWorkbook())).toEqual(expectedGolden);
  });

  it("uses article dates for a daily-detail multi-day report", () => {
    const result = parseMercalysSales(
      workbook(
        [
          [
            "0000087003017",
            "0000000003017",
            "POIRE CONFERENCE VRAC",
            "25/09/2026",
            1,
            2,
            0,
            3,
            0.16,
            0.84,
            28,
          ],
          [
            "0000087003017",
            "0000000003017",
            "POIRE CONFERENCE VRAC",
            "26/09/2026",
            2,
            4,
            0,
            6,
            0.31,
            1.69,
            28.17,
          ],
        ],
        {
          selection: "Du 25/09/2026 Au 26/09/2026",
          detail: "Par Jour",
          includeDate: true,
        },
      ),
    );

    expect(result.businessPeriodStart).toBe("2026-09-25");
    expect(result.businessPeriodEnd).toBe("2026-09-26");
    expect(result.records.map((record) => record.businessDate)).toEqual([
      "2026-09-25",
      "2026-09-26",
    ]);
  });

  it("reports invalid article rows without publishing partial records", () => {
    const result = parseMercalysSales(
      workbook([
        ["BAD-ID", "0000000003017", "", "pas-un-nombre", 2, 0, 3, 0.1, 0.9, 30],
      ]),
    );

    expect(result.records).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "INVALID_IDENTIFIER",
      "MISSING_LABEL",
      "INVALID_QUANTITY",
      "DECLARED_LINE_COUNT_MISMATCH",
    ]);
  });

  it("rejects waste and aggregated weekly reports", () => {
    expect(() =>
      parseMercalysSales(workbook([], { flow: "Casse" })),
    ).toThrowError(
      expect.objectContaining<Partial<MercalysSalesParseError>>({
        code: "MERCALYS_SOURCE_TYPE_MISMATCH",
      }),
    );
    expect(() =>
      parseMercalysSales(workbook([], { selection: "Du 39/2026 Au 39/2026" })),
    ).toThrowError(
      expect.objectContaining<Partial<MercalysSalesParseError>>({
        code: "MERCALYS_SALES_FORMAT_UNSUPPORTED",
      }),
    );
  });
});

const localSalesFixture = resolve(
  process.cwd(),
  "docs/files_examples/ventes_day_example.xlsx",
);

describe.skipIf(!existsSync(localSalesFixture))(
  "real daily Mercalys sales fixture",
  () => {
    it("normalizes all article rows and separates report controls", () => {
      const result = parseMercalysSales(
        spreadsheetParser.parse(readFileSync(localSalesFixture)),
      );

      expect(result.records).toHaveLength(147);
      expect(result.declaredLineCount).toBe(147);
      expect(result.businessPeriodStart).toBe("2026-09-26");
      expect(result.businessPeriodEnd).toBe("2026-09-26");
      expect(result.records[0]).toMatchObject({
        itm8: "0000087003017",
        ean: "0000000003017",
        businessDate: "2026-09-26",
        quantity: 1.82,
      });
      expect(result.controlTotals).toMatchObject({
        quantity: 1100.14,
        purchaseValue: 1546.9,
        salesValue: 2331.97,
      });
      expect(result.issues).toEqual([]);
    });
  },
);

function goldenWorkbook() {
  return workbook(
    [
      [
        "0000087003017",
        "0000000003017",
        "POIRE CONFERENCE VRAC",
        1.82,
        4.65,
        0,
        7.28,
        0.38,
        2.25,
        30.88,
      ],
      [
        "0000087003024",
        "2800146000000",
        "POIRE ROCHA VRAC",
        "1,25",
        "3,24",
        "0",
        "5,01",
        "0,26",
        "1,50",
        "30,02",
      ],
    ],
    {
      total: ["", "", "TOTAL", 3.07, 7.89, 0, 12.29, 0.64, 3.75, 30.51],
      lineCount: 2,
    },
  );
}

function workbook(
  articleRows: unknown[][],
  options: {
    flow?: "Vente Nette" | "Casse";
    selection?: string;
    detail?: "non détaillée" | "Par Jour";
    includeDate?: boolean;
    total?: unknown[];
    lineCount?: number;
  } = {},
) {
  const headers = ["ITM8 Prio", "EAN Prio", "Libellé"];
  if (options.includeDate) headers.push("Date");
  headers.push(
    "Quantité",
    "Valeur prix achat",
    "Valeur RCE",
    "Valeur prix vente",
    "Valeur TVA",
    "Val Marge",
    "% Marge",
  );
  const rows = [
    ["PDV: 00000 - MAGASIN TEST Date : 28/09/2026 Heure : 19:41:03"],
    [
      `Statistique : Entrées / Sorties: Niveau de détail: Par Article, Détail Période: ${options.detail ?? "non détaillée"}, Flux: ${options.flow ?? "Vente Nette"}, Type valorisation: PA`,
    ],
    [],
    [
      `Sélection de données : Du ${options.selection?.replace(/^Du /, "") ?? "26/09/2026 Au 26/09/2026"}`,
    ],
    ["Critères de sélection :"],
    ["Nomenclature : Du 20343400 à 20343402"],
    [],
    headers,
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
