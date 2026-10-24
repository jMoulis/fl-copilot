import { z } from "zod";
import { productSchema } from "./products";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotVisualMetadataEntrySchema } from "./copilot-visual-library";
import { storePhotoSourceMetadataSchema } from "./store-photo";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const legacyVisualActionInputSchema = z
  .strictObject({
    action: z.enum(["ASSIGN_LIBRARY", "REMOVE_PRODUCT", "REVOKE_CURRENT"]),
    productId: z.uuid(),
    visualIdentityId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.action === "ASSIGN_LIBRARY"
      ? v.visualIdentityId !== null
      : v.visualIdentityId === null,
  );
function validVisualAction(v: {
  action: string;
  visualIdentityId: string | null;
  sourceDocumentId?: string;
}) {
  return v.action === "ASSIGN_LIBRARY"
    ? v.visualIdentityId !== null && v.sourceDocumentId === undefined
    : v.visualIdentityId === null &&
        (v.action === "ASSIGN_SOURCE"
          ? !!v.sourceDocumentId
          : v.sourceDocumentId === undefined);
}
/** Capability 2 adds only an exact attached source ID; authority/paths remain native. */
export const sourceVisualActionInputSchema = z
  .strictObject({
    action: z.enum([
      "ASSIGN_LIBRARY",
      "REMOVE_PRODUCT",
      "REVOKE_CURRENT",
      "ASSIGN_SOURCE",
    ]),
    productId: z.uuid(),
    visualIdentityId: z.uuid().nullable(),
    sourceDocumentId: z.uuid().optional(),
  })
  .refine(validVisualAction);
/** Capability 3 prepares local failure review; no local record or decision is model-owned. */
export const visualActionInputSchema = z
  .strictObject({
    ...sourceVisualActionInputSchema.shape,
    action: z.enum([
      "ASSIGN_LIBRARY",
      "REMOVE_PRODUCT",
      "REVOKE_CURRENT",
      "ASSIGN_SOURCE",
      "REVIEW_RECOVERY",
    ]),
  })
  .refine(validVisualAction);
export const visualActionProofSchema = z.strictObject({
  entry: copilotVisualMetadataEntrySchema,
  hash: digest,
});
export const visualActionBasisSchema = z.strictObject({
  storeId: z.uuid(),
  product: z
    .strictObject({
      metadata: productSchema.pick({
        id: true,
        storeId: true,
        label: true,
        category: true,
        nature: true,
        salesUnit: true,
        status: true,
        version: true,
        deletedAt: true,
      }),
      hash: digest,
    })
    .nullable(),
  currentLink: visualActionProofSchema.nullable(),
  currentIdentity: visualActionProofSchema.nullable(),
  currentAsset: visualActionProofSchema.nullable(),
  selectedIdentity: visualActionProofSchema.nullable(),
  selectedAsset: visualActionProofSchema.nullable(),
  sourcePhoto: storePhotoSourceMetadataSchema.nullable().optional(),
  currentDisplay: z.enum(["ASSET", "PLACEHOLDER", "UNAVAILABLE"]),
});
export type VisualActionInput = z.infer<typeof visualActionInputSchema>;
export type VisualActionBasis = z.infer<typeof visualActionBasisSchema>;
export function validateVisualActionBasis(
  storeId: string,
  rawInput: unknown,
  raw: unknown,
) {
  const input = visualActionInputSchema.parse(rawInput),
    basis = visualActionBasisSchema.parse(raw);
  if (input.action === "ASSIGN_SOURCE") {
    if (
      basis.sourcePhoto &&
      basis.sourcePhoto.sourceDocumentId !== input.sourceDocumentId
    )
      throw Error("VISUAL_ACTION_SOURCE_INVALID");
  } else if (basis.sourcePhoto !== undefined)
    throw Error("VISUAL_ACTION_SOURCE_INVALID");
  if (
    input.action === "REVIEW_RECOVERY" &&
    (basis.currentLink ||
      basis.currentIdentity ||
      basis.currentAsset ||
      basis.selectedIdentity ||
      basis.selectedAsset ||
      basis.currentDisplay !== "UNAVAILABLE")
  )
    throw Error("VISUAL_RECOVERY_BASIS_INVALID");
  const {
    product,
    currentLink: l,
    currentIdentity: i,
    currentAsset: a,
    selectedIdentity: s,
    selectedAsset: t,
  } = basis;
  if (
    basis.storeId !== storeId ||
    (product &&
      (product.metadata.storeId !== storeId ||
        product.metadata.id !== input.productId))
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  for (const p of [l, i, a, s, t])
    if (p && p.entry.metadata.storeId !== storeId)
      throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    l &&
    (l.entry.kind !== "PRODUCT_VISUAL_LINK" ||
      l.entry.metadata.productId !== input.productId)
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    i &&
    (i.entry.kind !== "VISUAL_IDENTITY" ||
      l?.entry.kind !== "PRODUCT_VISUAL_LINK" ||
      i.entry.metadata.id !== l.entry.metadata.visualIdentityId)
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    a &&
    (a.entry.kind !== "VISUAL_ASSET" ||
      l?.entry.kind !== "PRODUCT_VISUAL_LINK" ||
      a.entry.metadata.id !==
        (l.entry.metadata.overrideAssetId ??
          (i?.entry.kind === "VISUAL_IDENTITY"
            ? i.entry.metadata.primaryAssetId
            : null)))
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    s &&
    (s.entry.kind !== "VISUAL_IDENTITY" ||
      s.entry.metadata.id !== input.visualIdentityId)
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    t &&
    (t.entry.kind !== "VISUAL_ASSET" ||
      s?.entry.kind !== "VISUAL_IDENTITY" ||
      t.entry.metadata.id !== s.entry.metadata.primaryAssetId)
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (input.action !== "ASSIGN_LIBRARY" && (s || t))
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    !product &&
    (l || i || a || s || t || basis.currentDisplay !== "UNAVAILABLE")
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    basis.currentDisplay === "ASSET" &&
    (!product ||
      product.metadata.status === "INACTIVE" ||
      product.metadata.deletedAt ||
      l?.entry.kind !== "PRODUCT_VISUAL_LINK" ||
      l.entry.metadata.deletedAt ||
      l.entry.metadata.verification !== "APPROVED" ||
      i?.entry.kind !== "VISUAL_IDENTITY" ||
      i.entry.metadata.deletedAt ||
      a?.entry.kind !== "VISUAL_ASSET" ||
      a.entry.metadata.deletedAt ||
      a.entry.metadata.reviewStatus !== "APPROVED")
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  if (
    basis.currentDisplay === "ASSET" &&
    a?.entry.kind === "VISUAL_ASSET" &&
    i?.entry.kind === "VISUAL_IDENTITY" &&
    l?.entry.kind === "PRODUCT_VISUAL_LINK"
  ) {
    const illustrative = a.entry.metadata.provenanceType === "AI_GENERATED";
    if (
      (illustrative &&
        (i.entry.metadata.specificity === "PACKAGED_EXACT" ||
          l.entry.metadata.linkType === "EXACT")) ||
      (product?.metadata.nature === "PACKAGED" &&
        l.entry.metadata.linkType === "EXACT" &&
        i.entry.metadata.specificity !== "PACKAGED_EXACT")
    )
      throw Error("VISUAL_ACTION_STATE_INVALID");
  }
  return basis;
}
export function visualActionStatus(
  input: VisualActionInput,
  b: VisualActionBasis,
) {
  if (input.action === "REVIEW_RECOVERY") return "REVIEW_LOCAL" as const;
  if (
    !b.product ||
    b.product.metadata.deletedAt ||
    b.product.metadata.status === "INACTIVE"
  )
    return "UNAVAILABLE" as const;
  if (input.action === "REMOVE_PRODUCT")
    return !b.currentLink || b.currentLink.entry.metadata.deletedAt
      ? ("UNCHANGED" as const)
      : ("READY" as const);
  if (input.action === "REVOKE_CURRENT")
    return b.currentDisplay === "ASSET"
      ? ("READY" as const)
      : ("UNAVAILABLE" as const);
  if (input.action === "ASSIGN_SOURCE")
    return b.sourcePhoto ? ("READY" as const) : ("UNAVAILABLE" as const);
  const i = b.selectedIdentity?.entry,
    a = b.selectedAsset?.entry;
  if (
    i?.kind !== "VISUAL_IDENTITY" ||
    a?.kind !== "VISUAL_ASSET" ||
    i.metadata.deletedAt ||
    a.metadata.deletedAt ||
    a.metadata.reviewStatus !== "APPROVED" ||
    (i.metadata.specificity === "PACKAGED_EXACT" &&
      a.metadata.provenanceType === "AI_GENERATED")
  )
    return "UNAVAILABLE" as const;
  return "READY" as const;
}
export const visualActionPreviewSchema = z.strictObject({
  input: visualActionInputSchema,
  basis: visualActionBasisSchema,
  status: z.enum([
    "READY",
    "REVIEW_LOCAL",
    "UNCHANGED",
    "UNAVAILABLE",
    "LIMIT_EXCEEDED",
  ]),
  evidence: z.array(copilotEvidenceSchema).min(1).max(2),
});
export function validateVisualActionPreview(
  storeId: string,
  input: unknown,
  raw: unknown,
) {
  const p = visualActionPreviewSchema.parse(raw);
  if (
    JSON.stringify(p.input) !==
    JSON.stringify(visualActionInputSchema.parse(input))
  )
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  validateVisualActionBasis(storeId, p.input, p.basis);
  if (
    p.status !== "LIMIT_EXCEEDED" &&
    p.status !== visualActionStatus(p.input, p.basis)
  )
    throw Error("VISUAL_ACTION_STATE_INVALID");
  return p;
}
export const visualActionProposalSchema = z.strictObject({
  kind: z.literal("VISUAL_ACTION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: visualActionInputSchema,
  basis: visualActionBasisSchema,
});
export function readVisualActionProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("VISUAL_ACTION_PROPOSAL_INVALID");
  const content = visualActionProposalSchema.parse(JSON.parse(message.text));
  validateVisualActionBasis(message.storeId, content.input, content.basis);
  if (
    !["READY", "REVIEW_LOCAL"].includes(
      visualActionStatus(content.input, content.basis),
    )
  )
    throw Error("VISUAL_ACTION_STATE_INVALID");
  return { message, content };
}
export const visualActionRequestSchema = z.strictObject({
  operationId: z.uuid(),
  basisHash: digest,
  photoReviewed: z.boolean(),
  confirmGlobalRevoke: z.boolean(),
  restoreAssociation: z.boolean(),
  rightsConfirmed: z.boolean().optional(),
});
export const visualActionResultSchema = visualActionRequestSchema
  .extend({
    userMessageId: z.uuid(),
    appliedAt: z.iso.datetime(),
    action: sourceVisualActionInputSchema.shape.action,
    productId: z.uuid(),
    sourceDocumentId: z.uuid().optional(),
    sourceChecksum: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    assetId: z.uuid().optional(),
    assetContentHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    entityId: z.uuid(),
    version: z.number().int().positive(),
    syncState: z.enum(["PENDING", "SYNCED"]),
  })
  .refine((v) =>
    v.action === "ASSIGN_SOURCE"
      ? !!v.sourceDocumentId &&
        !!v.sourceChecksum &&
        !!v.assetId &&
        !!v.assetContentHash &&
        v.photoReviewed &&
        v.rightsConfirmed === true
      : v.sourceDocumentId === undefined &&
        v.sourceChecksum === undefined &&
        v.assetId === undefined &&
        v.assetContentHash === undefined &&
        v.rightsConfirmed === undefined,
  );

export const visualRecoveryRequestSchema = z.strictObject({
  operationId: z.uuid(),
  basisHash: digest,
  kind: z.enum(["visual_asset", "visual_identity", "product_visual_link"]),
  entityId: z.uuid(),
  recoveryAction: z.enum([
    "RETRY_LOCAL",
    "REMOVE_LINK",
    "RETIRE_LOCAL",
    "ADOPT_REMOTE",
  ]),
  comparisonReviewed: z.literal(true),
  reactivate: z.boolean(),
  rightsConfirmed: z.boolean(),
});
export const visualRecoveryResultSchema = visualRecoveryRequestSchema
  .extend({
    action: z.literal("REVIEW_RECOVERY"),
    productId: z.uuid(),
    userMessageId: z.uuid(),
    appliedAt: z.iso.datetime(),
    version: z.number().int().positive(),
    syncState: z.enum(["PENDING", "SYNCED"]),
    retryFileAssetId: z.uuid().nullable(),
  })
  .refine(
    (v) =>
      v.retryFileAssetId === null ||
      (v.kind === "visual_asset" &&
        v.retryFileAssetId === v.entityId &&
        ["RETRY_LOCAL", "ADOPT_REMOTE"].includes(v.recoveryAction)),
  );

import {
  catalogueSnapshotIdentity,
  type CatalogueSnapshot,
} from "./copilot-catalogue-proposal";
import {
  copilotVisualMetadata,
  type CopilotVisualKind,
  copilotVisualTypes,
} from "./copilot-visual-library";
import {
  visualEntitySchemas,
  resolveProductVisual,
  type VisualEntityMap,
} from "./visual-library";
export type VisualActionEntities = {
  product: CatalogueSnapshot | null;
  currentLink: VisualEntityMap["product_visual_link"] | null;
  currentIdentity: VisualEntityMap["visual_identity"] | null;
  currentAsset: VisualEntityMap["visual_asset"] | null;
  selectedIdentity: VisualEntityMap["visual_identity"] | null;
  selectedAsset: VisualEntityMap["visual_asset"] | null;
};
/** Shared projection: full canonical hashes bind a compact model-facing proposal. */
export async function prepareVisualActionBasis(
  storeId: string,
  rawInput: unknown,
  full: VisualActionEntities,
  hash: (value: string) => Promise<string>,
  sourcePhoto?: z.infer<typeof storePhotoSourceMetadataSchema> | null,
): Promise<VisualActionBasis> {
  const input = visualActionInputSchema.parse(rawInput);
  async function proof(kind: CopilotVisualKind, raw: unknown | null) {
    if (!raw) return null;
    const value = visualEntitySchemas[copilotVisualTypes[kind]].parse(raw);
    return visualActionProofSchema.parse({
      entry: { kind, metadata: copilotVisualMetadata(kind, value) },
      hash: await hash(JSON.stringify(value)),
    });
  }
  const [link, identity, asset, selectedIdentity, selectedAsset, productHash] =
    await Promise.all([
      proof("PRODUCT_VISUAL_LINK", full.currentLink),
      proof("VISUAL_IDENTITY", full.currentIdentity),
      proof("VISUAL_ASSET", full.currentAsset),
      proof("VISUAL_IDENTITY", full.selectedIdentity),
      proof("VISUAL_ASSET", full.selectedAsset),
      full.product ? hash(catalogueSnapshotIdentity(full.product)) : null,
    ]);
  const p = full.product?.product.entity;
  const currentDisplay =
    p && input.action !== "REVIEW_RECOVERY"
      ? resolveProductVisual({
          product: p,
          links: full.currentLink ? [full.currentLink] : [],
          identities: full.currentIdentity ? [full.currentIdentity] : [],
          assets: full.currentAsset ? [full.currentAsset] : [],
        }).kind
      : "UNAVAILABLE";
  return validateVisualActionBasis(storeId, input, {
    storeId,
    ...(input.action === "ASSIGN_SOURCE"
      ? { sourcePhoto: sourcePhoto ?? null }
      : {}),
    product: p
      ? {
          metadata: {
            id: p.id,
            storeId: p.storeId,
            label: p.label,
            category: p.category,
            nature: p.nature,
            salesUnit: p.salesUnit,
            status: p.status,
            version: p.version,
            deletedAt: p.deletedAt,
          },
          hash: productHash,
        }
      : null,
    currentLink: link,
    currentIdentity: identity,
    currentAsset: asset,
    selectedIdentity,
    selectedAsset,
    currentDisplay,
  });
}
