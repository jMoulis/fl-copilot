import {
  visualEntitySchemas,
  validateVisualMutation,
  type VisualEntityMap,
  type VisualEntityType,
} from "./visual-library";

export function visualReactivationRequired(
  before: VisualEntityMap[VisualEntityType],
  after: VisualEntityMap[VisualEntityType],
) {
  return (
    (!!before.deletedAt && !after.deletedAt) ||
    ("review" in before &&
      "review" in after &&
      ["REJECTED", "REVOKED"].includes(before.review.status) &&
      after.review.status === "APPROVED" &&
      !after.deletedAt)
  );
}
/** A reviewed choice is rebased on the canonical revision, never a binary replacement. */
export function rebaseVisualChoice<K extends VisualEntityType>(
  kind: K,
  local: VisualEntityMap[K],
  remote: VisualEntityMap[K] | null,
  actorId: string,
  at: string,
) {
  if (remote && (local.id !== remote.id || local.storeId !== remote.storeId))
    throw Error("VISUAL_CONFLICT_SCOPE");
  if (!remote && local.createdBy !== actorId)
    throw Error("VISUAL_ACCESS_INVALID");
  const canonical = remote ?? local;
  if (
    "contentHash" in local &&
    "contentHash" in canonical &&
    (local.contentHash !== canonical.contentHash ||
      local.provenance.type !== canonical.provenance.type)
  )
    throw Error("VISUAL_BINARY_IMMUTABLE");
  const choice = {
    ...local,
    id: canonical.id,
    storeId: canonical.storeId,
    createdAt: canonical.createdAt,
    createdBy: canonical.createdBy,
    version: (remote?.version ?? 0) + 1,
    updatedBy: actorId,
    updatedAt: at,
  };
  if ("contentHash" in choice && "contentHash" in canonical) {
    choice.contentHash = canonical.contentHash;
    choice.mimeType = canonical.mimeType;
    choice.width = canonical.width;
    choice.height = canonical.height;
    choice.sizeBytes = canonical.sizeBytes;
    if (choice.provenance.type === "USER_UPLOAD" && !choice.deletedAt)
      choice.provenance = {
        ...choice.provenance,
        confirmedBy: actorId,
        confirmedAt: at,
      };
    if (choice.review.status !== "PENDING")
      choice.review = { ...choice.review, actorId, at };
  }
  if ("verification" in choice && choice.verification === "APPROVED") {
    choice.verifiedBy = actorId;
    choice.verifiedAt = at;
  }
  return validateVisualMutation(
    kind,
    remote,
    visualEntitySchemas[kind].parse(choice),
    {
      storeId: canonical.storeId,
      actorId,
      canWrite: true,
    },
  );
}
