import { randomUUID } from "node:crypto";
import {
  visualAssetSchema,
  visualIdentitySchema,
  productVisualLinkSchema,
} from "../packages/domain/src/visual-library";
import { productSchema } from "../packages/domain/src/products";
export function visualLibraryFixture() {
  const storeId = randomUUID(),
    actorId = randomUUID(),
    deviceId = randomUUID(),
    at = "2026-10-20T10:00:00.000Z";
  const base = {
    storeId,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const product = productSchema.parse({
    ...base,
    id: randomUUID(),
    label: "Tomate ronde vrac",
    category: "VEGETABLE",
    nature: "BULK",
    salesUnit: "KG",
    status: "ACTIVE",
    packaging: null,
    familyId: null,
    subfamilyId: null,
  });
  const asset = visualAssetSchema.parse({
    ...base,
    id: randomUUID(),
    contentHash: `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`,
    mimeType: "image/jpeg",
    width: 500,
    height: 500,
    sizeBytes: 1000,
    provenance: {
      type: "USER_UPLOAD",
      rights: "USER_CONFIRMED",
      confirmedBy: actorId,
      confirmedAt: at,
    },
    review: { status: "APPROVED", actorId, at },
  });
  const identity = visualIdentitySchema.parse({
    ...base,
    id: randomUUID(),
    canonicalName: "Tomate ronde rouge",
    specificity: "GENERIC",
    variety: null,
    appearance: null,
    brand: null,
    primaryAssetId: asset.id,
  });
  const link = productVisualLinkSchema.parse({
    ...base,
    id: randomUUID(),
    productId: product.id,
    visualIdentityId: identity.id,
    overrideAssetId: asset.id,
    linkType: "MANUAL_OVERRIDE",
    verification: "APPROVED",
    verifiedBy: actorId,
    verifiedAt: at,
  });
  return { storeId, actorId, deviceId, at, product, asset, identity, link };
}
