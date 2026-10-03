import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectMercalysSource } from "./mercalys-source-detector";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";

const parser = new SheetJsSpreadsheetParser();

describe("detectMercalysSource", () => {
  it.each([
    ["Vente Nette", "MERCALYS_SALES"],
    ["Casse", "MERCALYS_WASTE"],
  ] as const)("detects a single-day %s report", (flow, sourceType) => {
    const result = detectMercalysSource(
      workbook({ flow, selection: "Du 26/09/2026 Au 26/09/2026" }),
    );

    expect(result).toMatchObject({
      status: "DETECTED",
      sourceType,
      confidence: 1,
      formatVersion: "mercalys-entries-outputs.article.v1",
      granularity: "SINGLE_DAY",
      sheetName: "Mercalys",
      headerRowIndex: 7,
      businessDate: "2026-09-26",
      reasons: [],
    });
  });

  it("accepts a multi-day selection when article rows retain daily dates", () => {
    const result = detectMercalysSource(
      workbook({
        flow: "Vente Nette",
        selection: "Du 21/09/2026 Au 27/09/2026",
        detail: "Par Jour",
        includeDateColumn: true,
      }),
    );

    expect(result).toMatchObject({
      status: "DETECTED",
      sourceType: "MERCALYS_SALES",
      granularity: "DAILY_ROWS",
      businessDate: null,
    });
  });

  it.each([
    ["Vente Nette", "MERCALYS_SALES"],
    ["Casse", "MERCALYS_WASTE"],
  ] as const)(
    "recognizes but rejects a non-detailed weekly %s report",
    (flow, sourceType) => {
      const result = detectMercalysSource(
        workbook({ flow, selection: "Du 39/2026 Au 39/2026" }),
      );

      expect(result).toMatchObject({
        status: "UNSUPPORTED",
        sourceType,
        granularity: "AGGREGATED_PERIOD",
        reasons: ["AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"],
      });
    },
  );

  it("rejects a non-detailed monthly report for the same missing-date reason", () => {
    const result = detectMercalysSource(
      workbook({ flow: "Vente Nette", selection: "Du 09/2026 Au 09/2026" }),
    );

    expect(result).toMatchObject({
      status: "UNSUPPORTED",
      sourceType: "MERCALYS_SALES",
      granularity: "AGGREGATED_PERIOD",
      reasons: ["AGGREGATED_PERIOD_WITHOUT_DAILY_DATES"],
    });
  });

  it("rejects contradictory flow markers as ambiguous", () => {
    const report = workbook({
      flow: "Vente Nette, Flux: Casse",
      selection: "Du 26/09/2026 Au 26/09/2026",
    });

    expect(detectMercalysSource(report)).toMatchObject({
      status: "AMBIGUOUS",
      sourceType: null,
      reasons: ["CONFLICTING_FLOW_MARKERS"],
    });
  });

  it("rejects generic and structurally incomplete workbooks safely", () => {
    expect(
      detectMercalysSource(simpleWorkbook([["Produit", "Quantité"]])),
    ).toMatchObject({
      status: "UNSUPPORTED",
      sourceType: null,
      reasons: ["UNRECOGNIZED_WORKBOOK"],
    });

    const missingColumns = simpleWorkbook([
      [
        "Statistique : Entrées / Sorties: Niveau de détail: Par Article, Détail Période: non détaillée, Flux: Casse, Type valorisation: PA",
      ],
      ["Sélection de données : Du 26/09/2026 Au 26/09/2026"],
      ["Libellé", "Quantité"],
    ]);
    expect(detectMercalysSource(missingColumns)).toMatchObject({
      status: "UNSUPPORTED",
      sourceType: "MERCALYS_WASTE",
      reasons: ["MISSING_REQUIRED_COLUMNS"],
    });
  });
});

const fixtureDirectory = resolve(process.cwd(), "docs/files_examples");
const fixtureNames = existsSync(fixtureDirectory)
  ? readdirSync(fixtureDirectory)
      .filter(
        (name) =>
          !name.startsWith("~$") && name.toLowerCase().endsWith(".xlsx"),
      )
      .sort()
  : [];

describe.skipIf(fixtureNames.length === 0)("real Mercalys fixtures", () => {
  it("detects daily files and rejects aggregated weekly files", () => {
    const expectations = new Map([
      ["39_2026.xlsx", ["UNSUPPORTED", "MERCALYS_SALES"]],
      ["casse_39_2026.xlsx", ["UNSUPPORTED", "MERCALYS_WASTE"]],
      ["casse_day_example.xlsx", ["DETECTED", "MERCALYS_WASTE"]],
      ["ventes_day_example.xlsx", ["DETECTED", "MERCALYS_SALES"]],
    ]);
    expect(fixtureNames).toEqual([...expectations.keys()].sort());

    for (const fixtureName of fixtureNames) {
      const result = detectMercalysSource(
        parser.parse(readFileSync(resolve(fixtureDirectory, fixtureName))),
      );
      const expected = expectations.get(fixtureName);
      expect(result.status, fixtureName).toBe(expected?.[0]);
      expect(result.sourceType, fixtureName).toBe(expected?.[1]);
    }
  });
});

function workbook(input: {
  flow: string;
  selection: string;
  detail?: "non détaillée" | "Par Jour";
  includeDateColumn?: boolean;
}) {
  const columns = ["ITM8 Prio", "EAN Prio", "Libellé"];
  if (input.includeDateColumn) columns.push("Date");
  columns.push(
    "Quantité",
    "Valeur prix achat",
    "Valeur RCE",
    "Valeur prix vente",
    "Valeur TVA",
    "Val Marge",
    "% Marge",
  );
  return simpleWorkbook(
    [
      ["PDV: 09083 Date : 28/09/2026 Heure : 19:41:03"],
      [
        `Statistique : Entrées / Sorties: Niveau de détail: Par Article, Détail Période: ${input.detail ?? "non détaillée"}, Flux: ${input.flow}, Type valorisation: PA`,
      ],
      [],
      [`Sélection de données : ${input.selection}`],
      ["Critères de sélection :"],
      ["Nomenclature : Du 20343400 à 20343402"],
      [],
      columns,
    ],
    "Mercalys",
  );
}

function simpleWorkbook(rows: unknown[][], sheetName = "Rapport") {
  const xlsxWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    xlsxWorkbook,
    XLSX.utils.aoa_to_sheet(rows),
    sheetName,
  );
  const bytes = XLSX.write(xlsxWorkbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return parser.parse(bytes);
}
