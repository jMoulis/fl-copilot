import type { ParsedMercalysArticleRecord } from "./mercalys-article-parser";

export const MERCALYS_NORMALIZATION_VERSION = "mercalys-normalized-records.v1";

type CanonicalMercalysRecord = Omit<
  ParsedMercalysArticleRecord,
  "sourceIndex" | "rawValues"
>;

export function canonicalMercalysRecords(
  records: readonly ParsedMercalysArticleRecord[],
) {
  return records
    .map<CanonicalMercalysRecord>((record) => ({
      itm8: record.itm8,
      ean: record.ean,
      rawLabel: record.rawLabel,
      businessDate: record.businessDate,
      quantity: record.quantity,
      purchaseValue: record.purchaseValue,
      rceValue: record.rceValue,
      salesValue: record.salesValue,
      vatValue: record.vatValue,
      marginValue: record.marginValue,
      marginRate: record.marginRate,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

export function fingerprintMercalysRecords(
  records: readonly ParsedMercalysArticleRecord[],
) {
  const serialized = JSON.stringify({
    version: MERCALYS_NORMALIZATION_VERSION,
    records: canonicalMercalysRecords(records),
  });
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
