import {
  MAX_PROCUREMENT_SOURCE_BYTES,
  PROCUREMENT_PARSER_VERSION,
  procurementSourceSchema,
  procurementCatalogueSchema,
  type ProcurementCatalogue,
} from "@fl-copilot/domain";
import { strFromU8, strToU8 } from "fflate";

/** Deterministic projection. Never executes payload content or follows URLs. */
export function parseProcurementCatalogue(
  bytes: Uint8Array,
  expectedPdv: string,
): ProcurementCatalogue {
  if (!bytes.length || bytes.length > MAX_PROCUREMENT_SOURCE_BYTES)
    throw Error("PROCUREMENT_SOURCE_SIZE_INVALID");
  if (!/^\d{1,12}$/.test(expectedPdv))
    throw Error("PROCUREMENT_EXPECTED_PDV_REQUIRED");
  let raw: unknown;
  try {
    const utf8 =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
        ? bytes.subarray(3)
        : bytes;
    const text = strFromU8(utf8);
    const encoded = strToU8(text);
    if (encoded.length !== utf8.length || encoded.some((v, i) => v !== utf8[i]))
      throw Error("Invalid UTF-8");
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw Error("PROCUREMENT_JSON_INVALID");
  }
  const parsed = procurementSourceSchema.safeParse(raw);
  // Do not echo potentially private raw values in diagnostics.
  if (!parsed.success) throw Error("PROCUREMENT_SOURCE_FORMAT_INVALID");
  const source = parsed.data;
  // PDV is a store number, unlike generic/PLU/EAN identifiers. 09083 == 9083.
  if (BigInt(source.assortment.pdv) !== BigInt(expectedPdv))
    throw Error("PROCUREMENT_PDV_MISMATCH");
  const offers = new Set<string>();
  for (const a of source.articles) {
    if (offers.has(a._id)) throw Error("PROCUREMENT_DUPLICATE_OFFER");
    offers.add(a._id);
  }
  const quotes = new Map<string, (typeof source.assortment.articles)[number]>();
  for (const q of source.assortment.articles) {
    if (quotes.has(q._id)) throw Error("PROCUREMENT_DUPLICATE_TARIFF");
    if (!offers.has(q._id)) throw Error("PROCUREMENT_ORPHAN_TARIFF");
    quotes.set(q._id, q);
  }
  const decimal = (n: number | null | undefined) =>
    n == null ? null : String(n);
  return procurementCatalogueSchema.parse({
    parserVersion: PROCUREMENT_PARSER_VERSION,
    pdv: source.assortment.pdv,
    assortmentId: source.assortment._id,
    asOf: source.assortment.lastUpdate,
    offers: source.articles.map((a, sourceIndex) => {
      const q = quotes.get(a._id);
      return {
        sourceIndex,
        offerId: a._id,
        supplierProductId: a.productId,
        genericId: a.genericId,
        genericLabel: a.genericName,
        label: a.name,
        packagingCode: a.packagingCode,
        packagingLabel: a.packagingName,
        packagingQuantity: String(a.packagingQuantity),
        weight: String(a.weight),
        vatMultiplier: String(a.tva),
        origin: a.origin || null,
        sourceFamily: a.famille ?? null,
        sourceUniverse: a.univers ?? null,
        sourceCreatedAt: a.creationDate ?? null,
        sourceUpdatedAt: a.lastUpdate,
        tariff: q
          ? {
              base: q.base,
              purchasePrice: decimal(q.purchasePrice),
              sellingPrice: decimal(q.sellingPrice),
              priceUnit: q.priceUnit ?? null,
              unavailable: q.indispo ?? null,
              complementary: q.complementaire ?? null,
              orderDeadlines: q.orderDeadlines ?? [],
              deliveryDates: q.deliveryDates ?? [],
            }
          : null,
      };
    }),
  });
}

/** Stable serialization shared by local staging and future source verification. */
export function serializeProcurementCatalogue(raw: unknown) {
  return JSON.stringify(procurementCatalogueSchema.parse(raw));
}

export function procurementCatalogueBytes(raw: unknown) {
  return strToU8(serializeProcurementCatalogue(raw));
}
