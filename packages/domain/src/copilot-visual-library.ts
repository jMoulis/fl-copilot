import { productSchema } from "./products";
import { z } from "zod";
import { copilotEvidenceSchema } from "./copilot-candidate";
import {
  visualAssetSchema,
  visualIdentitySchema,
  productVisualLinkSchema,
  visualEntitySchemas,
} from "./visual-library";
export const copilotVisualKinds = [
  "VISUAL_ASSET",
  "VISUAL_IDENTITY",
  "PRODUCT_VISUAL_LINK",
] as const;
export const copilotVisualTypes = {
  VISUAL_ASSET: "visual_asset",
  VISUAL_IDENTITY: "visual_identity",
  PRODUCT_VISUAL_LINK: "product_visual_link",
} as const;
export type CopilotVisualKind = (typeof copilotVisualKinds)[number];
export function isCopilotVisualKind(kind: string): kind is CopilotVisualKind {
  return (copilotVisualKinds as readonly string[]).includes(kind);
}
const base = {
  id: z.uuid(),
  storeId: z.uuid(),
  version: z.number().int().positive(),
  deletedAt: z.iso.datetime({ offset: true }).nullable(),
};
export const copilotVisualAssetMetadataSchema = z.strictObject({
  ...base,
  contentHash: visualAssetSchema.shape.contentHash,
  mimeType: visualAssetSchema.shape.mimeType,
  sizeBytes: visualAssetSchema.shape.sizeBytes,
  width: visualAssetSchema.shape.width,
  height: visualAssetSchema.shape.height,
  provenanceType: z.enum([
    "USER_UPLOAD",
    "SUPPLIER",
    "LICENSED_SOURCE",
    "AI_GENERATED",
  ]),
  reviewStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "REVOKED"]),
});
export const copilotVisualIdentityMetadataSchema = z.strictObject({
  ...base,
  canonicalName: visualIdentitySchema.shape.canonicalName,
  specificity: visualIdentitySchema.shape.specificity,
  primaryAssetId: z.uuid().nullable(),
});
export const copilotProductVisualLinkMetadataSchema = z.strictObject({
  ...base,
  productId: z.uuid(),
  visualIdentityId: z.uuid(),
  overrideAssetId: z.uuid().nullable(),
  linkType: productVisualLinkSchema.shape.linkType,
  verification: productVisualLinkSchema.shape.verification,
});
export const copilotVisualMetadataSchemas = {
  VISUAL_ASSET: copilotVisualAssetMetadataSchema,
  VISUAL_IDENTITY: copilotVisualIdentityMetadataSchema,
  PRODUCT_VISUAL_LINK: copilotProductVisualLinkMetadataSchema,
} as const;
export function copilotVisualMetadata<K extends CopilotVisualKind>(
  kind: K,
  raw: unknown,
) {
  const e = visualEntitySchemas[copilotVisualTypes[kind]].parse(raw),
    b = {
      id: e.id,
      storeId: e.storeId,
      version: e.version,
      deletedAt: e.deletedAt,
    };
  const value =
    "contentHash" in e
      ? {
          ...b,
          contentHash: e.contentHash,
          mimeType: e.mimeType,
          sizeBytes: e.sizeBytes,
          width: e.width,
          height: e.height,
          provenanceType: e.provenance.type,
          reviewStatus: e.review.status,
        }
      : "canonicalName" in e
        ? {
            ...b,
            canonicalName: e.canonicalName,
            specificity: e.specificity,
            primaryAssetId: e.primaryAssetId,
          }
        : {
            ...b,
            productId: e.productId,
            visualIdentityId: e.visualIdentityId,
            overrideAssetId: e.overrideAssetId,
            linkType: e.linkType,
            verification: e.verification,
          };
  return copilotVisualMetadataSchemas[kind].parse(value);
}
export const copilotVisualLookupInputSchema = z
  .strictObject({
    productId: z.uuid().nullable(),
    kind: z.enum(copilotVisualKinds).nullable(),
    cursor: z.uuid().nullable(),
    query: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.productId ? v.kind === null && v.cursor === null : v.kind !== null) &&
      (!v.query || (!v.productId && v.kind === "VISUAL_IDENTITY")),
  );
export const copilotVisualMetadataEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("VISUAL_ASSET"),
    metadata: copilotVisualAssetMetadataSchema,
  }),
  z.strictObject({
    kind: z.literal("VISUAL_IDENTITY"),
    metadata: copilotVisualIdentityMetadataSchema,
  }),
  z.strictObject({
    kind: z.literal("PRODUCT_VISUAL_LINK"),
    metadata: copilotProductVisualLinkMetadataSchema,
  }),
]);
export const copilotVisualLookupResultSchema = z.strictObject({
  input: copilotVisualLookupInputSchema,
  storeId: z.uuid(),
  observedAt: z.iso.datetime(),
  sourceScope: z.literal("SYNCHRONIZED_METADATA_ONLY"),
  status: z.enum(["AVAILABLE", "PARTIAL", "PRODUCT_UNAVAILABLE"]),
  product: z
    .strictObject({
      id: z.uuid(),
      storeId: z.uuid(),
      label: productSchema.shape.label,
      status: productSchema.shape.status,
    })
    .nullable(),
  resolution: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("PLACEHOLDER"),
        category: productSchema.shape.category,
      }),
      z.strictObject({
        kind: z.literal("ASSET"),
        assetId: z.uuid(),
        identityId: z.uuid(),
        linkId: z.uuid(),
        illustrative: z.boolean(),
        generic: z.boolean(),
      }),
    ])
    .nullable(),
  entries: z.array(copilotVisualMetadataEntrySchema).max(10),
  nextCursor: z.uuid().nullable(),
  missingRelatedIds: z.array(z.uuid()).max(3),
  evidence: z.array(copilotEvidenceSchema).min(1).max(11),
});
export function validateCopilotVisualLookup(
  storeId: string,
  rawInput: unknown,
  raw: unknown,
) {
  const r = copilotVisualLookupResultSchema.parse(raw),
    input = copilotVisualLookupInputSchema.parse(rawInput);
  if (
    r.storeId !== storeId ||
    JSON.stringify(r.input) !== JSON.stringify(input) ||
    r.entries.some((e) => e.metadata.storeId !== storeId) ||
    (r.product &&
      (r.product.storeId !== storeId || r.product.id !== input.productId)) ||
    (!input.productId && r.entries.some((e) => e.kind !== input.kind))
  )
    throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
  const ids = r.entries.map((e) => e.metadata.id);
  if (
    new Set(ids).size !== ids.length ||
    (r.nextCursor && r.nextCursor !== ids.at(-1)) ||
    (input.productId && r.nextCursor)
  )
    throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
  if (
    !input.productId &&
    (r.resolution ||
      r.product ||
      r.status !== "AVAILABLE" ||
      r.missingRelatedIds.length ||
      ids.some(
        (id, i) =>
          (i > 0 && id <= ids[i - 1]!) ||
          (input.cursor !== null && id <= input.cursor),
      ))
  )
    throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
  if (input.productId) {
    const links = r.entries.filter((e) => e.kind === "PRODUCT_VISUAL_LINK"),
      identities = r.entries.filter((e) => e.kind === "VISUAL_IDENTITY"),
      assets = r.entries.filter((e) => e.kind === "VISUAL_ASSET");
    const link = links[0]?.metadata,
      identity = identities[0]?.metadata;
    if (
      links.length > 1 ||
      identities.length > 1 ||
      assets.length > 2 ||
      (link && link.productId !== input.productId) ||
      (identity && identity.id !== link?.visualIdentityId) ||
      (!link && r.entries.length)
    )
      throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
    const allowedAssets = [
      link?.overrideAssetId,
      identity?.primaryAssetId,
    ].filter(Boolean);
    const resolution = r.resolution;
    if ((r.status === "PRODUCT_UNAVAILABLE") !== (resolution === null))
      throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
    if (resolution?.kind === "ASSET") {
      const asset = assets.find(
        (a) => a.metadata.id === resolution.assetId,
      )?.metadata;
      if (
        !link ||
        !identity ||
        !asset ||
        link.deletedAt ||
        identity.deletedAt ||
        asset.deletedAt ||
        r.product?.status === "INACTIVE" ||
        link.verification !== "APPROVED" ||
        asset.reviewStatus !== "APPROVED" ||
        resolution.linkId !== link.id ||
        resolution.identityId !== identity.id ||
        resolution.assetId !==
          (link.overrideAssetId ?? identity.primaryAssetId) ||
        resolution.illustrative !== (asset.provenanceType === "AI_GENERATED") ||
        resolution.generic !== (identity.specificity !== "PACKAGED_EXACT")
      )
        throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
    }
    if (assets.some((e) => !allowedAssets.includes(e.metadata.id)))
      throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
    if (
      r.status === "PRODUCT_UNAVAILABLE"
        ? r.product !== null ||
          r.entries.length > 0 ||
          r.missingRelatedIds.length > 0
        : !r.product
    )
      throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
    if (
      r.status !== "PRODUCT_UNAVAILABLE" &&
      (r.status === "PARTIAL") !== r.missingRelatedIds.length > 0
    )
      throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
  }
  return r;
}

export const copilotVisualBasisFields = {
  VISUAL_ASSET: "visualAsset",
  VISUAL_IDENTITY: "visualIdentity",
  PRODUCT_VISUAL_LINK: "productVisualLink",
} as const;
