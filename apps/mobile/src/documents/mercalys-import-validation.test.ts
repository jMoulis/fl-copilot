import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type {
  Product,
  ProductIdentifier,
  ProductMatchCatalog,
} from "@fl-copilot/domain";
import {
  MercalysImportValidationError,
  rematchMercalysImport,
  validateMercalysImport,
  validateMercalysImportResponsive,
  rematchMercalysImportResponsive,
} from "./mercalys-import-validation";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";

const parser = new SheetJsSpreadsheetParser();
const storeId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-28T12:00:00.000Z";
const productIds = [
  "22222222-2222-4222-8222-222222222221",
  "22222222-2222-4222-8222-222222222222",
  "22222222-2222-4222-8222-222222222223",
] as const;

describe("validateMercalysImport", () => {
  it.each([
    ["Vente Nette", "MERCALYS_SALES"],
    ["Casse", "MERCALYS_WASTE"],
  ] as const)(
    "summarizes ready and product-review rows for %s",
    (flow, sourceType) => {
      const result = validateMercalysImport(
        workbook(flow, "Du 26/09/2026 Au 26/09/2026"),
        storeId,
        catalog(),
      );

      expect(result).toMatchObject({
        sourceType,
        businessPeriodStart: "2026-09-26",
        businessPeriodEnd: "2026-09-26",
        detectedLineCount: 3,
        readyCount: 1,
        productReviewCount: 2,
        errorCount: 0,
        issueCodes: [],
      });
      expect(result.lines.map((line) => line.match.state)).toEqual([
        "AUTO_MATCH",
        "AMBIGUOUS",
        "NO_MATCH",
      ]);
    },
  );

  it("explains why a weekly aggregate cannot be validated", () => {
    expect(() =>
      validateMercalysImport(
        workbook("Vente Nette", "Du 39/2026 Au 39/2026"),
        storeId,
        catalog(),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<MercalysImportValidationError>>({
        code: "AGGREGATED_PERIOD_WITHOUT_DAILY_DATES",
      }),
    );
  });

  it("re-evaluates unresolved lines after the local product master changes", () => {
    const initial = validateMercalysImport(
      workbook("Vente Nette", "Du 26/09/2026 Au 26/09/2026"),
      storeId,
      { products: [], identifiers: [], aliases: [] },
    );
    expect(initial).toMatchObject({ readyCount: 0, productReviewCount: 3 });

    const rematched = rematchMercalysImport(initial, storeId, catalog());

    expect(rematched).toMatchObject({ readyCount: 1, productReviewCount: 2 });
    expect(rematched.lines.map(({ match }) => match.state)).toEqual([
      "AUTO_MATCH",
      "AMBIGUOUS",
      "NO_MATCH",
    ]);
  });
});

function catalog(): ProductMatchCatalog {
  const products = productIds.map((id, index): Product => ({
    id,
    storeId,
    label: `Produit ${index + 1}`,
    category: "UNKNOWN",
    nature: "UNKNOWN",
    salesUnit: "UNKNOWN",
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "ACTIVE",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }));
  const identifiers: ProductIdentifier[] = [
    identifier("ITM8", "00000001", productIds[0]),
    identifier("ITM8", "00000002", productIds[0]),
    identifier("EAN", "0000000000002", productIds[1]),
  ];
  return { products, identifiers, aliases: [] };
}

function identifier(
  type: ProductIdentifier["type"],
  value: string,
  productId: string,
): ProductIdentifier {
  return {
    id:
      type === "ITM8" && value.endsWith("1")
        ? "33333333-3333-4333-8333-333333333331"
        : type === "ITM8"
          ? "33333333-3333-4333-8333-333333333332"
          : "33333333-3333-4333-8333-333333333333",
    storeId,
    productId,
    type,
    value,
    source: "MERCALYS",
    status: "VALIDATED",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function workbook(flow: string, selection: string) {
  const rows = [
    ["PDV: 00000 - MAGASIN TEST Date : 28/09/2026 Heure : 12:00:00"],
    [
      `Statistique : Entrées / Sorties: Niveau de détail: Par Article, Détail Période: non détaillée, Flux: ${flow}, Type valorisation: PA`,
    ],
    [],
    [`Sélection de données : ${selection}`],
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
    ["00000001", "0000000000001", "Premier article", 1, 1, 0, 2, 0.1, 0.9, 45],
    ["00000002", "0000000000002", "Article ambigu", 1, 1, 0, 2, 0.1, 0.9, 45],
    ["00000003", "0000000000003", "Article inconnu", 1, 1, 0, 2, 0.1, 0.9, 45],
    ["", "", "", 3, 3, 0, 6, 0.3, 2.7, 45],
    [],
    [`Nombre de Lignes : 3`],
  ];
  const xlsxWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    xlsxWorkbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Mercalys",
  );
  return parser.parse(
    XLSX.write(xlsxWorkbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer,
  );
}

it("responsive matching yields to UI and preserves deterministic results", async () => {
  const source = workbook("Vente Nette", "Du 26/09/2026 Au 26/09/2026");
  const expected = validateMercalysImport(source, storeId, catalog());
  let responded = false;
  const timer = setTimeout(() => {
    responded = true;
  }, 0);
  try {
    expect(
      await validateMercalysImportResponsive(source, storeId, catalog()),
    ).toEqual(expected);
    expect(responded).toBe(true);
    expect(
      await rematchMercalysImportResponsive(expected, storeId, catalog()),
    ).toEqual(rematchMercalysImport(expected, storeId, catalog()));
  } finally {
    clearTimeout(timer);
  }
});
it("responsive matching can be interrupted from the UI before completion", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await expect(
      validateMercalysImportResponsive(
        workbook("Vente Nette", "Du 26/09/2026 Au 26/09/2026"),
        storeId,
        catalog(),
        controller.signal,
      ),
    ).rejects.toThrow("MERCALYS_BATCH_CANCELLED");
  } finally {
    clearTimeout(timer);
  }
});

it("keeps dispatching UI work throughout a large rematch", async () => {
  const seed = validateMercalysImport(
    workbook("Vente Nette", "Du 26/09/2026 Au 26/09/2026"),
    storeId,
    catalog(),
  );
  const large = {
    ...seed,
    lines: Array.from({ length: 100 }, () => seed.lines).flat(),
  };
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 0);
  try {
    const result = await rematchMercalysImportResponsive(
      large,
      storeId,
      catalog(),
    );
    expect(result).toEqual(rematchMercalysImport(large, storeId, catalog()));
    expect(ticks).toBeGreaterThan(2);
  } finally {
    clearInterval(heartbeat);
  }
});

it("reports monotonic line progress and stops reporting when cancelled", async () => {
  const source = workbook("Vente Nette", "Du 26/09/2026 Au 26/09/2026");
  const progress: Array<{ completed: number; total: number }> = [];
  const summary = await validateMercalysImportResponsive(
    source,
    storeId,
    catalog(),
    undefined,
    (value) => progress.push(value),
  );
  expect(progress[0]).toEqual({ completed: 0, total: summary.lines.length });
  expect(progress.at(-1)).toEqual({
    completed: summary.lines.length,
    total: summary.lines.length,
  });
  expect(progress.map((p) => p.completed)).toEqual(
    progress.map((p) => p.completed).sort((a, b) => a - b),
  );
  const controller = new AbortController();
  const cancelled: number[] = [];
  await expect(
    validateMercalysImportResponsive(
      source,
      storeId,
      catalog(),
      controller.signal,
      (value) => {
        cancelled.push(value.completed);
        controller.abort();
      },
    ),
  ).rejects.toThrow("MERCALYS_BATCH_CANCELLED");
  expect(cancelled).toEqual([0]);
});
