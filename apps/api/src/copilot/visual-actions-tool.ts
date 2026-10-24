import { createHash } from "node:crypto";
import type { Db, Document } from "mongodb";
import {
  visualActionInputSchema,
  prepareVisualActionBasis,
  visualActionStatus,
  validateVisualActionPreview,
  visualIdFromDigest,
  visualIdMaterial,
  visualEntitySchemas,
  type VisualEntityType,
  type VisualEntityMap,
} from "@fl-copilot/domain";
import {
  visualCollections,
  serializeVisualEntity,
} from "../products/visual-library-sync.js";
import { readCataloguePreview } from "./catalogue-preview-tool.js";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** Prepare only. Native canonical services and explicit user confirmation own mutation. */
export async function previewVisualAction(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = visualActionInputSchema.parse(raw);
  const catalogue = await readCataloguePreview(db, storeId, {
    action: "INSPECT",
    productId: input.productId,
    patch: {},
  });
  async function get<K extends VisualEntityType>(
    kind: K,
    id: string | null,
  ): Promise<VisualEntityMap[K] | null> {
    if (!id) return null;
    const row = await db
      .collection<Document & { _id: string }>(visualCollections[kind])
      .findOne({ _id: id, storeId }, { maxTimeMS: 2000 });
    if (!row) return null;
    const e = visualEntitySchemas[kind].parse(serializeVisualEntity(kind, row));
    if (e.id !== id || e.storeId !== storeId)
      throw Error("VISUAL_ACTION_SCOPE_INVALID");
    if (kind !== "visual_identity") {
      const key =
        "contentHash" in e
          ? e.contentHash
          : "productId" in e
            ? e.productId
            : "";
      if (
        e.id !== visualIdFromDigest(hash(visualIdMaterial(kind, storeId, key)))
      )
        throw Error("VISUAL_ID_INVALID");
    }
    return e as VisualEntityMap[K];
  }
  const product = catalogue.before;
  const currentLink = product
    ? await get(
        "product_visual_link",
        visualIdFromDigest(
          hash(
            visualIdMaterial("product_visual_link", storeId, input.productId),
          ),
        ),
      )
    : null;
  const [currentIdentity, selectedIdentity] = product
    ? await Promise.all([
        get("visual_identity", currentLink?.visualIdentityId ?? null),
        input.action === "ASSIGN_LIBRARY"
          ? get("visual_identity", input.visualIdentityId)
          : null,
      ])
    : [null, null];
  const [currentAsset, selectedAsset] = await Promise.all([
    get(
      "visual_asset",
      currentLink?.overrideAssetId ?? currentIdentity?.primaryAssetId ?? null,
    ),
    get("visual_asset", selectedIdentity?.primaryAssetId ?? null),
  ]);
  const basis = await prepareVisualActionBasis(
    storeId,
    input,
    {
      product,
      currentLink,
      currentIdentity,
      currentAsset,
      selectedIdentity,
      selectedAsset,
    },
    async (v) => hash(v),
  );
  const status =
    catalogue.status === "LIMIT_EXCEEDED"
      ? "LIMIT_EXCEEDED"
      : visualActionStatus(input, basis);
  return validateVisualActionPreview(storeId, input, {
    input,
    basis,
    status,
    evidence: [
      {
        id: `visual-action/${hash(JSON.stringify([input, basis, status]))}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.productId,
        sourceVersion: product?.product.entity.version ?? null,
        label: product?.product.entity.label ?? "Image produit",
        factKind: "QUALITY",
        value:
          status === "READY"
            ? "Proposition visuelle uniquement : aucun choix enregistré. Confirmation explicite sur l’appareil ; originaux conservés."
            : status === "UNCHANGED"
              ? "Aucune association active à retirer dans ce catalogue synchronisé."
              : "Cette action ne peut pas être préparée avec ces métadonnées synchronisées. Aucune absence ni image indisponible ne vaut autorisation de recréation.",
      },
    ],
  });
}
