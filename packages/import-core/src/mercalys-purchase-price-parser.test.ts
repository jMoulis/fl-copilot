import { expect, it } from "vitest";
import { purchasePriceNeedsReview } from "@fl-copilot/domain";
import { parseMercalysPurchasePrices } from "./mercalys-purchase-price-parser";
import { detectMercalysSource } from "./mercalys-source-detector";
import { fingerprintMercalysRecords } from "./normalized-records";
import type { SpreadsheetWorkbook } from "./spreadsheet-parser";

function workbook(
  rows: (string | number | null)[][],
  date = "14/11/2026",
): SpreadsheetWorkbook {
  const values = [
    ["Numéro point de vente : 9083"],
    ["Date : 18/11/2026 17:00:00"],
    [`Date d'application :${date}`],
    ["ITM", "EAN", "LIBELLE", "NOMENCLATURE", "PRIX ACHAT PAR UNITE", "ACTIF"],
    ...rows,
  ];
  return {
    sheets: [
      {
        name: "Mercalys",
        rowCount: values.length,
        columnCount: 6,
        empty: false,
        rows: values.map((row) =>
          row.map((value) => ({
            kind:
              value === null
                ? "EMPTY"
                : typeof value === "number"
                  ? "NUMBER"
                  : "STRING",
            value,
            formattedValue: null,
            numberFormat: null,
            formula: null,
          })),
        ),
      },
    ],
  };
}
const line = [
  "0000087000001",
  "0000000000012",
  "POMME TEST",
  "FRUITS FRAIS",
  1.235,
  "Oui",
];
function referenceWorkbook() {
  const w = workbook([[...line, 3.06, "5,5%"]]);
  w.sheets[0]!.rows[3]!.push(
    ...["PV TTC", "Code TVA"].map((value) => ({
      kind: "STRING" as const,
      value,
      formattedValue: null,
      numberFormat: null,
      formula: null,
    })),
  );
  return w;
}
it("reads authoritative reference PV/TVA without inferring category or packaging, including formatted percentages", () => {
  const w = referenceWorkbook();
  const parsed = parseMercalysPurchasePrices(w);
  expect(parsed.parserVersion).toBe("mercalys-article-reference.v1");
  expect(parsed.records[0]!.purchasePrice?.reference).toEqual({
    sellingPriceTtc: "3.06",
    vatRate: "5.5",
  });
  const legacy = parseMercalysPurchasePrices(w, { articleReference: false });
  expect(legacy.parserVersion).toBe("mercalys-purchase-prices.v1");
  expect(legacy.records[0]!.purchasePrice?.reference).toBeUndefined();
  w.sheets[0]!.rows[4]![7] = {
    kind: "NUMBER",
    value: 0.055,
    formattedValue: "5,5%",
    numberFormat: "0.0%",
    formula: null,
  };
  expect(
    parseMercalysPurchasePrices(w).records[0]!.purchasePrice?.reference
      ?.vatRate,
  ).toBe("5.5");
});
it("rejects missing reference columns and malformed/formula prices without silently treating the file as PA-only", () => {
  const w = referenceWorkbook();
  w.sheets[0]!.rows[3]!.pop();
  expect(() => parseMercalysPurchasePrices(w)).toThrow(
    "MERCALYS_REFERENCE_COLUMNS_INCOMPLETE",
  );
  const invalid = referenceWorkbook();
  invalid.sheets[0]!.rows[4]![6]!.formula = "=1+1";
  expect(parseMercalysPurchasePrices(invalid).issues).toContainEqual({
    code: "INVALID_PURCHASE_PRICE_ROW",
    sourceIndex: 4,
  });
  const badVat = referenceWorkbook();
  badVat.sheets[0]!.rows[4]![7]!.value = "105%";
  expect(parseMercalysPurchasePrices(badVat).records).toHaveLength(0);
});
it("recognizes a dated price snapshot without inventing movements and preserves identifiers/precision", () => {
  const input = workbook([line, ["Nombre de lignes : :000001"]]);
  expect(detectMercalysSource(input).sourceType).toBe(
    "MERCALYS_PURCHASE_PRICES",
  );
  const result = parseMercalysPurchasePrices(input);
  expect(result).toMatchObject({
    storeCode: "9083",
    businessPeriodStart: "2026-11-14",
    declaredLineCount: 1,
    issues: [],
  });
  expect(result.records[0]).toMatchObject({
    itm8: "0000087000001",
    ean: "0000000000012",
    quantity: null,
    purchaseValue: null,
    salesValue: null,
    purchasePrice: { amount: "1.235", sourceActive: true },
  });
  const corrected = result.records.map((r) => ({
    ...r,
    purchasePrice: { ...r.purchasePrice! },
  }));
  corrected[0]!.purchasePrice!.amount = "1.45";
  expect(fingerprintMercalysRecords(corrected)).not.toBe(
    fingerprintMercalysRecords(result.records),
  );
});
it.each(["31/02/2026", "", "14/13/2026"])(
  "does not substitute generation date for invalid application date %s",
  (date) => {
    expect(() => parseMercalysPurchasePrices(workbook([line], date))).toThrow();
  },
);
it("keeps inactive source status without dropping its line and rejects numeric identifiers", () => {
  const result = parseMercalysPurchasePrices(
    workbook([
      [...line.slice(0, 5), "Non"],
      [123, ...line.slice(1)],
    ]),
  );
  expect(result.records).toHaveLength(1);
  expect(result.records[0]!.purchasePrice!.sourceActive).toBe(false);
  expect(result.issues).toEqual([
    { code: "INVALID_PURCHASE_PRICE_ROW", sourceIndex: 5 },
  ]);
});
it("reports conflicting duplicate identifiers, footer mismatches and missing prices", () => {
  const result = parseMercalysPurchasePrices(
    workbook([
      line,
      line,
      [...line.slice(0, 4), null, "Oui"],
      ["Nombre de lignes : :3"],
    ]),
  );
  expect(result.issues.map((i) => i.code)).toEqual([
    "DUPLICATE_PURCHASE_PRICE_IDENTIFIER",
    "INVALID_PURCHASE_PRICE_ROW",
    "DECLARED_LINE_COUNT_MISMATCH",
  ]);
});
it.each([
  ["0.01", true],
  ["0.0100", true],
  ["0.001", true],
  ["0", false],
  ["0.02", false],
  ["1.01", false],
])("qualifies the owner-approved placeholder %s only", (amount, expected) => {
  expect(purchasePriceNeedsReview(String(amount))).toBe(expected);
});
