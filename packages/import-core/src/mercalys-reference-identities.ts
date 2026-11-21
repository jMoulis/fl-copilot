import {
  referenceIdentityFactSchema,
  type ReferenceIdentityFact,
} from "@fl-copilot/domain";
import {
  detectMercalysSource,
  normalizeSemanticText,
} from "./mercalys-source-detector";
import type {
  SpreadsheetWorkbook,
  SpreadsheetCell,
} from "./spreadsheet-parser";
export const MERCALYS_REFERENCE_IDENTITY_VERSION =
  "mercalys-reference-identities.v1";
function plu(
  c: SpreadsheetCell | undefined,
): Pick<ReferenceIdentityFact, "plu" | "pluSourceKind"> {
  if (c?.formula) throw Error("INVALID_PLU");
  if (!c || c.value == null || c.value === "")
    return { plu: null, pluSourceKind: "MISSING" };
  if (c.kind === "STRING" && /^\d{1,80}$/.test(String(c.value).trim()))
    return { plu: String(c.value).trim(), pluSourceKind: "TEXT" };
  if (
    c.kind === "NUMBER" &&
    typeof c.value === "number" &&
    Number.isSafeInteger(c.value) &&
    c.value >= 0
  ) {
    const format = c.numberFormat ?? "General";
    if (format === "General")
      return { plu: String(c.value), pluSourceKind: "INTEGER" };
    if (/^0{1,80}$/.test(format))
      return {
        plu: String(c.value).padStart(format.length, "0"),
        pluSourceKind: "FORMATTED_INTEGER",
      };
  }
  throw Error("INVALID_PLU");
}
/** Companion identity facts, independent from amounts, ACTIF and PA availability.
 * No Product/PA writes and no ITM suffix inference. Financial v1 normalization is unchanged.
 */
export function parseMercalysReferenceIdentities(
  workbook: SpreadsheetWorkbook,
) {
  const d = detectMercalysSource(workbook);
  if (
    d.status !== "DETECTED" ||
    d.sourceType !== "MERCALYS_PURCHASE_PRICES" ||
    d.headerRowIndex === null ||
    !d.businessDate
  )
    throw Error("MERCALYS_REFERENCE_IDENTITY_FORMAT_INVALID");
  const sheet = workbook.sheets.find((s) => s.name === d.sheetName)!;
  const text = (c: SpreadsheetCell | undefined) =>
    c?.value == null ? "" : String(c.value).trim();
  const headers = sheet.rows[d.headerRowIndex]!.map((c) =>
    normalizeSemanticText(text(c)),
  );
  for (const h of ["EAN", "LIBELLE", "PV TTC", "CODE TVA"])
    if (headers.filter((v) => v === h).length !== 1)
      throw Error("MERCALYS_REFERENCE_IDENTITY_FORMAT_INVALID");
  if (headers.filter((h) => h === "PLU").length > 1)
    throw Error("MERCALYS_REFERENCE_IDENTITY_FORMAT_INVALID");
  const codeColumn = headers.indexOf(headers.includes("ITM") ? "ITM" : "ITM8"),
    eanColumn = headers.indexOf("EAN"),
    labelColumn = headers.indexOf("LIBELLE"),
    pluColumn = headers.indexOf("PLU");
  const storeCode = sheet.rows
    .slice(0, d.headerRowIndex)
    .flatMap((r) => r.map(text))
    .join(" ")
    .match(/Num[eé]ro point de vente\s*:\s*(\d+)/i)?.[1];
  if (!storeCode) throw Error("MERCALYS_REFERENCE_PDV_REQUIRED");
  const references: ReferenceIdentityFact[] = [],
    issues: { sourceIndex: number; code: string }[] = [];
  for (
    let sourceIndex = d.headerRowIndex + 1;
    sourceIndex < sheet.rows.length;
    sourceIndex++
  ) {
    const row = sheet.rows[sourceIndex]!;
    if (
      row.every((c) => !text(c)) ||
      /^Nombre de lignes\s*:/i.test(text(row[0]))
    )
      continue;
    if (references.length + issues.length >= 5000)
      throw Error("MERCALYS_REFERENCE_IDENTITY_TOO_LARGE");
    const a = row[codeColumn],
      b = row[eanColumn],
      label = row[labelColumn];
    if (
      a?.kind !== "STRING" ||
      b?.kind !== "STRING" ||
      a.formula ||
      b.formula ||
      label?.formula ||
      !/^\d+$/.test(text(a)) ||
      !/^\d+$/.test(text(b)) ||
      !text(label)
    ) {
      issues.push({ sourceIndex, code: "INVALID_REFERENCE_IDENTITY" });
      continue;
    }
    try {
      references.push(
        referenceIdentityFactSchema.parse({
          sourceIndex,
          itm8: text(a),
          ean: text(b),
          label: text(label),
          ...plu(row[pluColumn]),
        }),
      );
    } catch {
      issues.push({ sourceIndex, code: "INVALID_REFERENCE_PLU" });
    }
  }
  return {
    parserVersion:
      MERCALYS_REFERENCE_IDENTITY_VERSION as typeof MERCALYS_REFERENCE_IDENTITY_VERSION,
    storeCode,
    businessDate: d.businessDate,
    references,
    issues,
  };
}
