import {
  visualIdMaterial,
  visualIdFromDigest,
  type CanonicalVisualKind,
  type VisualEntityType,
  type VisualEntityMap,
} from "@fl-copilot/domain";
import { digestVisualId } from "./visual-id-digest";
export async function nativeVisualId(
  kind: CanonicalVisualKind,
  storeId: string,
  key: string,
) {
  const material = visualIdMaterial(kind, storeId, key);
  return visualIdFromDigest(await digestVisualId(material));
}
export async function assertCanonicalVisualId(
  kind: VisualEntityType,
  value: VisualEntityMap[VisualEntityType],
) {
  if (kind === "visual_identity") return;
  const key =
    "contentHash" in value
      ? value.contentHash
      : "productId" in value
        ? value.productId
        : "";
  if (value.id !== (await nativeVisualId(kind, value.storeId, key)))
    throw Error("VISUAL_ID_INVALID");
}
