import type { ProductMasterRepository } from "./product-master-repository";

export type BarcodeLookupResult =
  | { status: "FOUND"; productId: string }
  | { status: "UNKNOWN" | "AMBIGUOUS" | "UNVALIDATED" | "INVALID" };

/** Literal EAN lookup only. UPC-A may be reported as EAN-13 on iOS.
 * Internal store codes are allowed: do not enforce a global GS1 checksum.
 * Never interpret a price/weight prefix or strip arbitrary leading zeroes. */
export function barcodeLookupCodes(raw: string): string[] {
  const code = raw.trim();
  if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(code)) return [];
  if (code.length === 12) return [code, `0${code}`];
  if (code.length === 13 && code.startsWith("0")) return [code, code.slice(1)];
  return [code];
}

export async function lookupProductBarcode(
  repository: Pick<
    ProductMasterRepository,
    "findIdentifiersByCodes" | "getProduct"
  >,
  storeId: string,
  raw: string,
): Promise<BarcodeLookupResult> {
  const codes = barcodeLookupCodes(raw);
  if (!codes.length) return { status: "INVALID" };
  const identifiers = (
    await repository.findIdentifiersByCodes(
      storeId,
      codes.map((value) => ({ type: "EAN", value })),
    )
  ).filter(
    ({ entity }) =>
      entity.storeId === storeId &&
      !entity.deletedAt &&
      entity.type === "EAN" &&
      codes.includes(entity.value),
  );
  const owners = [
    ...new Set(identifiers.map(({ entity }) => entity.productId)),
  ];
  const records = await Promise.all(
    owners.map((id) => repository.getProduct(id)),
  );
  const products = records.filter(
    (record) =>
      record && record.entity.storeId === storeId && !record.entity.deletedAt,
  );
  if (!products.length) return { status: "UNKNOWN" };
  if (products.length > 1) return { status: "AMBIGUOUS" };
  const productId = products[0]!.entity.id;
  if (
    identifiers.some(
      ({ entity }) =>
        entity.productId === productId && entity.status !== "VALIDATED",
    )
  )
    return { status: "UNVALIDATED" };
  // Inactive references remain viewable; this read does not reactivate them.
  return { status: "FOUND", productId };
}
