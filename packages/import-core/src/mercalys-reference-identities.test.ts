import { expect, it } from "vitest";
import { referenceBytes } from "../../../scripts/test-procurement-reference-fixtures";
import { SheetJsSpreadsheetParser } from "./sheetjs-spreadsheet-parser";
import { parseMercalysReferenceIdentities } from "./mercalys-reference-identities";
import { parseMercalysPurchasePrices } from "./mercalys-purchase-price-parser";
const workbook = () => new SheetJsSpreadsheetParser().parse(referenceBytes());
it("accepts the exact ITM8 header alias without changing financial normalization", () => {
  const w = workbook();
  const a = parseMercalysPurchasePrices(w);
  w.sheets[0]!.rows[2]![0]!.value = "ITM";
  expect(parseMercalysPurchasePrices(w)).toEqual(a);
  expect(a.records).toHaveLength(1);
});
it.each([
  ["005002", null, "005002", "TEXT"],
  [5002, "General", "5002", "INTEGER"],
  [5002, "000000", "005002", "FORMATTED_INTEGER"],
  [null, null, null, "MISSING"],
])(
  "retains only the PLU representation actually supplied (%s)",
  (value, numberFormat, plu, pluSourceKind) => {
    const w = workbook(),
      c = w.sheets[0]!.rows[3]![8]!;
    Object.assign(c, {
      value,
      numberFormat,
      kind:
        typeof value === "number"
          ? "NUMBER"
          : value === null
            ? "EMPTY"
            : "STRING",
    });
    const result = parseMercalysReferenceIdentities(w);
    expect(result.issues).toEqual([]);
    expect(result.references[0]).toMatchObject({
      plu,
      pluSourceKind,
      itm8: "0000087005002",
    });
  },
);
it.each(["=5002", 5002.5, -2, "5002x"])(
  "excludes invalid PLU evidence %s",
  (value) => {
    const w = workbook(),
      c = w.sheets[0]!.rows[3]![8]!;
    c.value = value;
    c.kind = typeof value === "number" ? "NUMBER" : "STRING";
    expect(parseMercalysReferenceIdentities(w).issues).toEqual([
      { sourceIndex: 3, code: "INVALID_REFERENCE_PLU" },
    ]);
  },
);
it("does not couple identity to unavailable PA, ACTIF, or a price formula", () => {
  const w = workbook(),
    row = w.sheets[0]!.rows[3]!;
  row[4]!.formula = "1/0";
  row[4]!.value = 999;
  row[5]!.value = "Non";
  expect(parseMercalysReferenceIdentities(w).references).toHaveLength(1);
  row[8]!.formula = "5002";
  expect(parseMercalysReferenceIdentities(w).references).toHaveLength(0);
});
it("rejects ambiguous ITM headers rather than picking by column order", () => {
  const w = workbook();
  w.sheets[0]!.rows[2]!.push({ ...w.sheets[0]!.rows[2]![0]!, value: "ITM" });
  expect(() => parseMercalysReferenceIdentities(w)).toThrow();
  expect(() => parseMercalysPurchasePrices(w)).toThrow();
});
