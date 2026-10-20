import { z } from "zod";
import type { Product } from "./products";

export const VISUAL_LIBRARY_POLICY = Object.freeze({
  automaticGeneration: false,
  automaticLookup: false,
  maximumBytes: 12 * 1024 * 1024,
  maximumPixels: 36_000_000,
});
/** Small binary signature check shared by native capture and server validation. */
export function detectVisualImageMime(
  bytes: Uint8Array,
): VisualAsset["mimeType"] | null {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    )
  )
    return "image/png";
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) !== "ftyp") return null;
  const brands = ascii(8, 40);
  if (brands.includes("avif") || brands.includes("avis")) return null;
  if (["heic", "heix", "hevc", "hevx"].some((v) => brands.includes(v)))
    return "image/heic";
  if (["mif1", "msf1"].some((v) => brands.includes(v))) return "image/heif";
  return null;
}
const id = z.uuid();
const text = z.string().trim().min(1).max(500);
const instant = z.iso.datetime({ offset: true });
const base = {
  id,
  storeId: id,
  createdBy: id,
  updatedBy: id,
  version: z.number().int().positive(),
  createdAt: instant,
  updatedAt: instant,
  deletedAt: instant.nullable(),
};
const referenceUrl = z
  .url({ protocol: /^https$/ })
  .refine(
    (value) => /^https:\/\/[^/?#@]+(?:[/?#]|$)/i.test(value),
    "Une référence HTTPS sans identifiant est requise.",
  );
const license = z
  .strictObject({
    type: z.enum(["SUPPLIER_PERMISSION", "COMMERCIAL_LICENSE", "CC0", "CC_BY"]),
    reference: text,
    attribution: text.nullable(),
  })
  .refine(
    (v) => v.type !== "CC_BY" || !!v.attribution,
    "L’attribution est obligatoire.",
  );
export const visualProvenanceSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("USER_UPLOAD"),
    rights: z.literal("USER_CONFIRMED"),
    confirmedBy: id,
    confirmedAt: instant,
  }),
  z.strictObject({
    type: z.literal("SUPPLIER"),
    provider: text,
    sourceUrl: referenceUrl.nullable(),
    license,
  }),
  z.strictObject({
    type: z.literal("LICENSED_SOURCE"),
    provider: text,
    sourceUrl: referenceUrl,
    license,
  }),
  z.strictObject({
    type: z.literal("AI_GENERATED"),
    provider: text,
    model: text,
    promptVersion: text,
  }),
]);
const review = z
  .strictObject({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "REVOKED"]),
    actorId: id.nullable(),
    at: instant.nullable(),
  })
  .refine(
    (v) => v.status === "PENDING" || (!!v.actorId && !!v.at),
    "Une décision doit être attribuée et datée.",
  );
export const visualAssetSchema = z
  .strictObject({
    ...base,
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(VISUAL_LIBRARY_POLICY.maximumBytes),
    width: z.number().int().positive().max(12000),
    height: z.number().int().positive().max(12000),
    provenance: visualProvenanceSchema,
    review,
  })
  .refine(
    (v) => v.width * v.height <= VISUAL_LIBRARY_POLICY.maximumPixels,
    "Cette image est trop grande.",
  );
export type VisualAsset = z.infer<typeof visualAssetSchema>;

export const visualIdentitySchema = z.strictObject({
  ...base,
  canonicalName: z.string().trim().min(1).max(240),
  specificity: z.enum(["GENERIC", "VARIETY", "PACKAGED_EXACT"]),
  variety: text.nullable(),
  appearance: text.nullable(),
  brand: text.nullable(),
  primaryAssetId: id.nullable(),
});
export type VisualIdentity = z.infer<typeof visualIdentitySchema>;
export const productVisualLinkSchema = z
  .strictObject({
    ...base,
    productId: id,
    visualIdentityId: id,
    overrideAssetId: id.nullable(),
    linkType: z.enum(["EXACT", "INHERITED_GENERIC", "MANUAL_OVERRIDE"]),
    verification: z.enum(["APPROVED", "NEEDS_REVIEW"]),
    verifiedBy: id.nullable(),
    verifiedAt: instant.nullable(),
  })
  .refine(
    (v) => v.verification !== "APPROVED" || (!!v.verifiedBy && !!v.verifiedAt),
    "Un lien approuvé doit être attribué et daté.",
  )
  .refine(
    (v) =>
      v.linkType === "MANUAL_OVERRIDE"
        ? !!v.overrideAssetId
        : v.overrideAssetId === null,
    "Seule une correction manuelle peut porter une image de remplacement.",
  );
export type ProductVisualLink = z.infer<typeof productVisualLinkSchema>;

export const visualEntitySchemas = {
  visual_asset: visualAssetSchema,
  visual_identity: visualIdentitySchema,
  product_visual_link: productVisualLinkSchema,
} as const;
export type VisualEntityType = keyof typeof visualEntitySchemas;
export function isVisualEntityType(value: string): value is VisualEntityType {
  return (
    value === "visual_asset" ||
    value === "visual_identity" ||
    value === "product_visual_link"
  );
}
export type VisualEntityMap = {
  [K in VisualEntityType]: z.infer<(typeof visualEntitySchemas)[K]>;
};

/** Same mutation policy on device and server; file validation/rights review remain separate. */
export function validateVisualMutation<K extends VisualEntityType>(
  kind: K,
  before: VisualEntityMap[K] | null,
  raw: unknown,
  context: { storeId: string; actorId: string; canWrite: boolean },
): VisualEntityMap[K] {
  const next = visualEntitySchemas[kind].parse(raw) as VisualEntityMap[K];
  id.parse(context.actorId);
  if (
    !context.canWrite ||
    next.updatedBy !== context.actorId ||
    (!before && next.createdBy !== context.actorId) ||
    next.storeId !== context.storeId ||
    (before && before.storeId !== context.storeId)
  )
    throw Error("VISUAL_ACCESS_INVALID");
  if (
    next.version !== (before?.version ?? 0) + 1 ||
    (before &&
      (before.id !== next.id ||
        before.createdAt !== next.createdAt ||
        before.createdBy !== next.createdBy))
  )
    throw Error("VISUAL_REVISION_INVALID");
  if (kind === "visual_asset") {
    const asset = next as VisualAsset,
      previous = before as VisualAsset | null;
    if (
      previous &&
      (previous.contentHash !== asset.contentHash ||
        previous.mimeType !== asset.mimeType ||
        previous.width !== asset.width ||
        previous.height !== asset.height ||
        previous.sizeBytes !== asset.sizeBytes ||
        previous.provenance.type !== asset.provenance.type)
    )
      throw Error("VISUAL_BINARY_IMMUTABLE");
    // An inert tombstone may retain its original attestation date, never forge another author.
    if (
      asset.provenance.type === "USER_UPLOAD" &&
      (!previous ||
        JSON.stringify(previous.provenance) !==
          JSON.stringify(asset.provenance)) &&
      asset.provenance.confirmedBy !== context.actorId
    )
      throw Error("VISUAL_RIGHTS_CONFIRMATION_INVALID");
    if (
      asset.provenance.type === "USER_UPLOAD" &&
      !asset.deletedAt &&
      (!previous ||
        !!previous.deletedAt ||
        (["REJECTED", "REVOKED"].includes(previous.review.status) &&
          asset.review.status === "APPROVED") ||
        JSON.stringify(previous.provenance) !==
          JSON.stringify(asset.provenance)) &&
      (asset.provenance.confirmedBy !== context.actorId ||
        asset.provenance.confirmedAt !== asset.updatedAt)
    )
      throw Error("VISUAL_RIGHTS_CONFIRMATION_INVALID");
    if (
      asset.review.status !== "PENDING" &&
      (asset.review.actorId !== context.actorId ||
        asset.review.at !== asset.updatedAt)
    )
      throw Error("VISUAL_REVIEW_REQUIRED");
  }
  if (kind === "product_visual_link") {
    const link = next as ProductVisualLink,
      previous = before as ProductVisualLink | null;
    if (previous && previous.productId !== link.productId)
      throw Error("VISUAL_PRODUCT_IMMUTABLE");
    if (
      link.verification === "APPROVED" &&
      (link.verifiedBy !== context.actorId ||
        link.verifiedAt !== link.updatedAt)
    )
      throw Error("VISUAL_REVIEW_REQUIRED");
  }
  return next;
}

export type ProductVisualResolution =
  | { kind: "PLACEHOLDER"; category: Product["category"] }
  | {
      kind: "ASSET";
      asset: VisualAsset;
      identity: VisualIdentity;
      link: ProductVisualLink;
      illustrative: boolean;
      generic: boolean;
    };

/** Resolve approved explicit links only. Label similarity never validates a visual identity. */
export function resolveProductVisual(input: {
  product: Product;
  links: readonly ProductVisualLink[];
  identities: readonly VisualIdentity[];
  assets: readonly VisualAsset[];
}): ProductVisualResolution {
  const { product } = input;
  const placeholder: ProductVisualResolution = {
    kind: "PLACEHOLDER",
    category: product.category,
  };
  if (product.deletedAt || product.status === "INACTIVE") return placeholder;
  const links = input.links.filter(
    (l) =>
      !l.deletedAt &&
      l.storeId === product.storeId &&
      l.productId === product.id,
  );
  // Multiple live links are an identity conflict, never an invitation to pick the newest.
  if (links.length !== 1 || links[0]!.verification !== "APPROVED")
    return placeholder;
  const link = links[0]!;
  const identities = input.identities.filter(
    (i) =>
      i.id === link.visualIdentityId &&
      i.storeId === product.storeId &&
      !i.deletedAt,
  );
  if (identities.length !== 1) return placeholder;
  const identity = identities[0]!;
  const assetId = link.overrideAssetId ?? identity.primaryAssetId;
  const assets = input.assets.filter(
    (a) => a.id === assetId && a.storeId === product.storeId && !a.deletedAt,
  );
  if (assets.length !== 1 || assets[0]!.review.status !== "APPROVED")
    return placeholder;
  const asset = assets[0]!;
  const illustrative = asset.provenance.type === "AI_GENERATED";
  if (
    (identity.specificity === "PACKAGED_EXACT" || link.linkType === "EXACT") &&
    illustrative
  )
    return placeholder;
  if (
    product.nature === "PACKAGED" &&
    link.linkType === "EXACT" &&
    identity.specificity !== "PACKAGED_EXACT"
  )
    return placeholder;
  return {
    kind: "ASSET",
    asset,
    identity,
    link,
    illustrative,
    generic: identity.specificity !== "PACKAGED_EXACT",
  };
}

/** Store-scoped immutable binary key; metadata never carries local device paths or public URLs. */
export function visualAssetObjectKey(asset: VisualAsset) {
  const value = visualAssetSchema.parse(asset);
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  }[value.mimeType];
  return `stores/${value.storeId}/visual-assets/${value.contentHash.slice(7)}.${extension}`;
}
