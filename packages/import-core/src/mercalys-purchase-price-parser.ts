import {
  detectMercalysSource,
  normalizeSemanticText,
} from "./mercalys-source-detector";
import type {
  SpreadsheetWorkbook,
  SpreadsheetCell,
} from "./spreadsheet-parser";
import type { ParsedMercalysArticleRecord } from "./mercalys-article-parser";

export const MERCALYS_PURCHASE_PRICE_PARSER_VERSION =
  "mercalys-purchase-prices.v1";
export function parseMercalysPurchasePrices(
  workbook: SpreadsheetWorkbook,
  options: { articleReference?: boolean } = {},
) {
  const d = detectMercalysSource(workbook);
  if (
    d.status !== "DETECTED" ||
    d.sourceType !== "MERCALYS_PURCHASE_PRICES" ||
    !d.businessDate ||
    d.headerRowIndex === null
  )
    throw Error("MERCALYS_PURCHASE_PRICE_FORMAT_UNSUPPORTED");
  const sheet = workbook.sheets.find((s) => s.name === d.sheetName)!;
  const text = (c?: SpreadsheetCell) =>
    c?.value == null ? "" : String(c.value).trim();
  const headers = sheet.rows[d.headerRowIndex]!.map((c) =>
    normalizeSemanticText(text(c)),
  );
  const columns = [
    "ITM",
    "EAN",
    "LIBELLE",
    "NOMENCLATURE",
    "PRIX ACHAT PAR UNITE",
    "ACTIF",
  ].map((h) =>
    h === "ITM" && !headers.includes("ITM")
      ? headers.indexOf("ITM8")
      : headers.indexOf(h),
  );
  const records: ParsedMercalysArticleRecord[] = [];
  const pvColumn = headers.indexOf("PV TTC"),
    vatColumn = headers.indexOf("CODE TVA");
  const isReference =
    options.articleReference !== false && pvColumn >= 0 && vatColumn >= 0;
  if (options.articleReference !== false && pvColumn >= 0 !== vatColumn >= 0)
    throw Error("MERCALYS_REFERENCE_COLUMNS_INCOMPLETE");
  const issues: { code: string; sourceIndex: number | null }[] = [];
  const identifiers = new Set<string>();
  let declaredLineCount: number | null = null;
  for (
    let sourceIndex = d.headerRowIndex + 1;
    sourceIndex < sheet.rows.length;
    sourceIndex++
  ) {
    const row = sheet.rows[sourceIndex]!;
    if (row.every((c) => !text(c))) continue;
    const footer = text(row[0]).match(
      /^Nombre de lignes\s*:\s*:?\s*(\d+)\s*$/i,
    );
    if (footer) {
      declaredLineCount = Number(footer[1]);
      continue;
    }
    const cells = columns.map((i) => row[i]);
    const [itm, ean, rawLabel, nomenclature, price, active] = cells.map(
      text,
    ) as [string, string, string, string, string, string];
    // Text identifiers preserve zeros; reject numeric codes whose original width is lost.
    const validIdentifiers = cells
      .slice(0, 2)
      .every((c) => c?.kind === "STRING" && /^\d+$/.test(text(c)));
    const amount = price.replace(/\s/g, "").replace(",", ".");
    const sellingPriceTtc = text(row[pvColumn])
      .replace(/\s/g, "")
      .replace(",", ".");
    const vatText = row[vatColumn]?.formattedValue?.includes("%")
      ? row[vatColumn]!.formattedValue!
      : text(row[vatColumn]);
    const vatRate = vatText
      .replace(/\s/g, "")
      .replace(/%$/, "")
      .replace(",", ".");
    if (
      !validIdentifiers ||
      !rawLabel ||
      !/^\d+(?:\.\d+)?$/.test(amount) ||
      !["OUI", "NON"].includes(normalizeSemanticText(active)) ||
      cells.some((c) => c?.formula) ||
      (isReference &&
        (!/^\d+(?:\.\d+)?$/.test(sellingPriceTtc) ||
          !/^\d+(?:\.\d+)?$/.test(vatRate) ||
          Number(vatRate) > 100 ||
          row[pvColumn]?.formula ||
          row[vatColumn]?.formula))
    ) {
      issues.push({ code: "INVALID_PURCHASE_PRICE_ROW", sourceIndex });
      continue;
    }
    if (identifiers.has(itm)) {
      issues.push({ code: "DUPLICATE_PURCHASE_PRICE_IDENTIFIER", sourceIndex });
      continue;
    }
    identifiers.add(itm);
    records.push({
      sourceIndex,
      itm8: itm,
      ean,
      rawLabel,
      businessDate: d.businessDate,
      quantity: null,
      purchaseValue: null,
      rceValue: null,
      salesValue: null,
      vatValue: null,
      marginValue: null,
      marginRate: null,
      purchasePrice: {
        amount,
        sourceActive: normalizeSemanticText(active) === "OUI",
        nomenclature,
        ...(isReference ? { reference: { sellingPriceTtc, vatRate } } : {}),
      },
      rawValues: {
        priceAmount: cells[4]?.value as string | number,
        sourceActive: active,
        nomenclature,
        ...(isReference
          ? {
              sellingPriceTtc: row[pvColumn]!.value as string | number,
              vatRate: row[vatColumn]!.value as string | number,
            }
          : {}),
        itm8: itm,
        ean,
        rawLabel,
        businessDate: d.businessDate,
        quantity: null,
        purchaseValue: null,
        rceValue: null,
        salesValue: null,
        vatValue: null,
        marginValue: null,
        marginRate: null,
      },
    });
  }
  if (declaredLineCount !== null && declaredLineCount !== records.length)
    issues.push({ code: "DECLARED_LINE_COUNT_MISMATCH", sourceIndex: null });
  const storeCode =
    sheet.rows
      .slice(0, d.headerRowIndex)
      .flatMap((r) => r.map(text))
      .join(" ")
      .match(/Num[eé]ro point de vente\s*:\s*(\d+)/i)?.[1] ?? null;
  return {
    sourceType: "MERCALYS_PURCHASE_PRICES" as const,
    parserVersion: isReference
      ? "mercalys-article-reference.v1"
      : MERCALYS_PURCHASE_PRICE_PARSER_VERSION,
    businessPeriodStart: d.businessDate,
    businessPeriodEnd: d.businessDate,
    sheetName: sheet.name,
    headerRowIndex: d.headerRowIndex,
    formatVersion: d.formatVersion!,
    records,
    declaredLineCount,
    issues,
    storeCode,
    controlTotals: null,
  };
}
