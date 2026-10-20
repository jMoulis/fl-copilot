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
  remote: VisualEntityMap[K],
  actorId: string,
  at: string,
) {
  if (local.id !== remote.id || local.storeId !== remote.storeId)
    throw Error("VISUAL_CONFLICT_SCOPE");
  if (
    "contentHash" in local &&
    "contentHash" in remote &&
    (local.contentHash !== remote.contentHash ||
      local.provenance.type !== remote.provenance.type)
  )
    throw Error("VISUAL_BINARY_IMMUTABLE");
  const choice = {
    ...local,
    id: remote.id,
    storeId: remote.storeId,
    createdAt: remote.createdAt,
    createdBy: remote.createdBy,
    version: remote.version + 1,
    updatedBy: actorId,
    updatedAt: at,
  };
  if ("contentHash" in choice && "contentHash" in remote) {
    choice.contentHash = remote.contentHash;
    choice.mimeType = remote.mimeType;
    choice.width = remote.width;
    choice.height = remote.height;
    choice.sizeBytes = remote.sizeBytes;
    if (choice.provenance.type === "USER_UPLOAD")
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
      storeId: remote.storeId,
      actorId,
      canWrite: true,
    },
  );
}
