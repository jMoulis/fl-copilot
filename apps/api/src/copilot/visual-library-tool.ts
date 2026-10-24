import { copilotEvidenceSchema } from "@fl-copilot/domain";
import { createHash } from "node:crypto";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import {
  copilotVisualLookupInputSchema,
  copilotVisualLookupResultSchema,
  resolveProductVisual,
  type VisualEntityMap,
  type VisualEntityType,
  copilotVisualMetadataEntrySchema,
  copilotVisualMetadata,
  copilotVisualTypes,
  validateCopilotVisualLookup,
  visualIdMaterial,
  visualIdFromDigest,
  type CopilotVisualKind,
} from "@fl-copilot/domain";
import {
  visualCollections,
  serializeVisualEntity,
} from "../products/visual-library-sync.js";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
export async function readVisualLibrary(db: Db, storeId: string, raw: unknown) {
  z.uuid().parse(storeId);
  const input = copilotVisualLookupInputSchema.parse(raw),
    entries: Array<z.infer<typeof copilotVisualMetadataEntrySchema>> = [],
    missingRelatedIds: string[] = [],
    entities: Array<VisualEntityMap[VisualEntityType]> = [];
  let resolution: z.infer<
    typeof copilotVisualLookupResultSchema
  >["resolution"] = null;
  let nextCursor: string | null = null,
    product: {
      id: string;
      storeId: string;
      label: string;
      status: "ACTIVE" | "INACTIVE" | "TO_REVIEW";
    } | null = null,
    status: "AVAILABLE" | "PARTIAL" | "PRODUCT_UNAVAILABLE" = "AVAILABLE";
  const collection = (kind: CopilotVisualKind) =>
    db.collection<Document & { _id: string }>(
      visualCollections[copilotVisualTypes[kind]],
    );
  function add(kind: CopilotVisualKind, row: Document & { _id: string }) {
    const entity = serializeVisualEntity(copilotVisualTypes[kind], row);
    if (entity.storeId !== storeId || entity.id !== row._id)
      throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
    const key =
      "contentHash" in entity
        ? entity.contentHash
        : "productId" in entity
          ? entity.productId
          : null;
    if (
      key !== null &&
      entity.id !==
        visualIdFromDigest(
          createHash("sha256")
            .update(
              visualIdMaterial(
                "contentHash" in entity
                  ? "visual_asset"
                  : "product_visual_link",
                storeId,
                key,
              ),
            )
            .digest("hex"),
        )
    )
      throw Error("VISUAL_LOOKUP_ID_INVALID");
    const entry = copilotVisualMetadataEntrySchema.parse({
      kind,
      metadata: copilotVisualMetadata(kind, entity),
    });
    entries.push(entry);
    entities.push(entity);
    return entity;
  }
  if (input.productId) {
    const row = await db
      .collection<ProductDocument>("products")
      .findOne(
        { _id: input.productId, storeId, deletedAt: null },
        { maxTimeMS: 2000 },
      );
    if (!row) status = "PRODUCT_UNAVAILABLE";
    else {
      const p = serializeProductDocument(row);
      if (p.id !== input.productId || p.storeId !== storeId)
        throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
      product = { id: p.id, storeId, label: p.label, status: p.status };
      const linkId = visualIdFromDigest(
        createHash("sha256")
          .update(visualIdMaterial("product_visual_link", storeId, p.id))
          .digest("hex"),
      );
      const linkRow = await collection("PRODUCT_VISUAL_LINK").findOne(
        { _id: linkId, storeId },
        { maxTimeMS: 2000 },
      );
      if (linkRow) {
        const link = add("PRODUCT_VISUAL_LINK", linkRow);
        if (!("productId" in link) || link.productId !== p.id)
          throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
        const identityRow = await collection("VISUAL_IDENTITY").findOne(
          { _id: link.visualIdentityId, storeId },
          { maxTimeMS: 2000 },
        );
        const identity = identityRow
          ? add("VISUAL_IDENTITY", identityRow)
          : null;
        if (!identity) missingRelatedIds.push(link.visualIdentityId);
        const assetIds = [
          ...new Set(
            [
              link.overrideAssetId,
              identity && "primaryAssetId" in identity
                ? identity.primaryAssetId
                : null,
            ].filter((id): id is string => !!id),
          ),
        ];
        if (assetIds.length) {
          const rows = await collection("VISUAL_ASSET")
            .find({ _id: { $in: assetIds }, storeId })
            .maxTimeMS(2000)
            .sort({ _id: 1 })
            .limit(3)
            .toArray();
          for (const r of rows) {
            if (!assetIds.includes(r._id))
              throw Error("VISUAL_LOOKUP_SCOPE_INVALID");
            add("VISUAL_ASSET", r);
          }
          for (const id of assetIds)
            if (!rows.some((r) => r._id === id)) missingRelatedIds.push(id);
        }
        if (missingRelatedIds.length) status = "PARTIAL";
      }
      const selected = resolveProductVisual({
        product: p,
        links: entities.filter(
          (e): e is VisualEntityMap["product_visual_link"] => "productId" in e,
        ),
        identities: entities.filter(
          (e): e is VisualEntityMap["visual_identity"] => "canonicalName" in e,
        ),
        assets: entities.filter(
          (e): e is VisualEntityMap["visual_asset"] => "contentHash" in e,
        ),
      });
      resolution =
        selected.kind === "PLACEHOLDER"
          ? selected
          : {
              kind: "ASSET",
              assetId: selected.asset.id,
              identityId: selected.identity.id,
              linkId: selected.link.id,
              illustrative: selected.illustrative,
              generic: selected.generic,
            };
    }
  } else {
    const kind = input.kind!,
      rows = await collection(kind)
        .find({
          storeId,
          ...(input.cursor ? { _id: { $gt: input.cursor } } : {}),
        })
        .maxTimeMS(2000)
        .sort({ _id: 1 })
        .limit(11)
        .toArray();
    for (const row of rows.slice(0, 10)) add(kind, row);
    if (rows.length > 10) nextCursor = entries.at(-1)!.metadata.id;
  }
  const observedAt = new Date().toISOString();
  const evidence = entries.map((e): z.infer<typeof copilotEvidenceSchema> => ({
    id: `visual-metadata/${e.metadata.id}/${e.metadata.version}`,
    sourceType: "DATA_QUALITY",
    sourceId: e.metadata.id,
    sourceVersion: e.metadata.version,
    label:
      "canonicalName" in e.metadata
        ? e.metadata.canonicalName
        : e.kind === "VISUAL_ASSET"
          ? "Image produit"
          : "Image associée au produit",
    factKind: "QUALITY",
    value:
      "Métadonnées visuelles synchronisées uniquement. La lecture ne télécharge aucune image et ne confirme ni droits, ni correspondance, ni modification sur l’appareil.",
  }));
  if (!evidence.length)
    evidence.push({
      id: `visual-metadata-query/${createHash("sha256")
        .update(storeId + JSON.stringify(input) + observedAt)
        .digest("hex")}`,
      sourceType: "DATA_QUALITY",
      sourceId: storeId,
      sourceVersion: null,
      label: "Bibliothèque visuelle",
      factKind: "QUALITY",
      value:
        status === "PRODUCT_UNAVAILABLE"
          ? "La fiche demandée n’est pas disponible dans ce catalogue synchronisé. Les modifications locales ne sont pas consultées."
          : "Aucune métadonnée visuelle dans ce résultat synchronisé. Les modifications locales ne sont pas consultées.",
    });
  return validateCopilotVisualLookup(storeId, input, {
    input,
    storeId,
    observedAt,
    sourceScope: "SYNCHRONIZED_METADATA_ONLY",
    status,
    product,
    entries,
    resolution,
    nextCursor,
    missingRelatedIds,
    evidence,
  });
}
