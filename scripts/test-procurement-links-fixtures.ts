import { randomUUID } from "node:crypto";
import { referenceBytes } from "./test-procurement-reference-fixtures";
import {
  productSchema,
  productIdentifierSchema,
  type ProcurementProductLink,
} from "../packages/domain/src/index";
import {
  procurementPublicationFixture,
  procurementHash,
} from "./test-procurement-publication-fixtures";
import { applyProductMasterSnapshot } from "../apps/mobile/src/products/apply-product-master";
import {
  ProcurementProductLinkRepository,
  procurementProductLinkId,
} from "../apps/mobile/src/products/procurement-links";
export const linkTime = "2026-11-22T08:00:00.000Z";
export async function procurementLinksFixture() {
  const f = await procurementPublicationFixture();
  const snapshot = await f.repository.publish(f.publicationInput, () => {});
  const referenceId = randomUUID(),
    bytes = referenceBytes(),
    checksum = await procurementHash(bytes);
  // Keep the canonical source metadata/schema and immutable original; no financial publication is needed.
  const source = f.device.raw
    .prepare("SELECT * FROM source_documents WHERE id=?")
    .get(f.input.sourceDocumentId)!;
  const keys = Object.keys(source),
    values = keys.map((k) =>
      k === "id"
        ? referenceId
        : k === "source_type"
          ? "MERCALYS_PURCHASE_PRICES"
          : k === "checksum"
            ? checksum
            : k === "local_file_uri"
              ? "file:///reference.xlsx"
              : k === "original_filename"
                ? "ref.xlsx"
                : source[k],
    );
  f.device.raw
    .prepare(
      `INSERT INTO source_documents(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
    )
    .run(...(values as (string | number | null)[]));
  const product = productSchema.parse({
    id: randomUUID(),
    storeId: f.config.storeId,
    label: "CAROTTE VRAC",
    category: "VEGETABLE",
    nature: "BULK",
    salesUnit: "KG",
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "ACTIVE",
    version: 1,
    createdAt: linkTime,
    updatedAt: linkTime,
    deletedAt: null,
  });
  const identifiers = (
    [
      ["ITM8", "87005002"],
      ["EAN", "2800500200000"],
    ] as const
  ).map(([type, value]) =>
    productIdentifierSchema.parse({
      id: randomUUID(),
      storeId: product.storeId,
      productId: product.id,
      type,
      value,
      source: "MERCALYS",
      status: "VALIDATED",
      version: 1,
      createdAt: linkTime,
      updatedAt: linkTime,
      deletedAt: null,
    }),
  );
  await applyProductMasterSnapshot(f.device, product.storeId, {
    products: [product],
    productIdentifiers: identifiers,
    productAliases: [],
  });
  const repository = new ProcurementProductLinkRepository(f.device, {
    read: async () => bytes,
    sha256: procurementHash,
  });
  const preview = await repository.preview(
    product.storeId,
    snapshot.id,
    referenceId,
  );
  const link: ProcurementProductLink = {
    id: procurementProductLinkId(product.storeId, "005002"),
    storeId: product.storeId,
    genericId: "005002",
    productId: product.id,
    status: "ACTIVE",
    basis: {
      catalogueSnapshotId: snapshot.id,
      catalogueChecksum: snapshot.checksum,
      referenceDocumentId: referenceId,
      referenceChecksum: checksum,
      referenceParserVersion: preview.facts.parserVersion,
      reference: preview.facts.references[0]!,
      method: "EXPLICIT_PLU",
      reason: null,
    },
    version: 1,
    createdBy: f.ownerId,
    updatedBy: f.ownerId,
    createdAt: linkTime,
    updatedAt: linkTime,
  };
  const context = () => ({
    reviewId: randomUUID(),
    commandId: randomUUID(),
    deviceId: f.publicationInput.deviceId,
    actorId: f.ownerId,
    storeId: product.storeId,
    createdAt: linkTime,
    assertCurrentScope: () => {},
  });
  return {
    ...f,
    snapshot,
    referenceId,
    referenceBytes: bytes,
    referenceChecksum: checksum,
    product,
    identifiers,
    links: repository,
    preview,
    link,
    context,
  };
}
