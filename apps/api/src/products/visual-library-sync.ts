import { createHash } from "node:crypto";
import { visualIdMaterial, visualIdFromDigest } from "@fl-copilot/domain";
import {
  visualEntitySchemas,
  validateVisualMutation,
  type VisualEntityType,
} from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import type { Document } from "mongodb";

export const visualCollections = {
  visual_asset: "visualAssets",
  visual_identity: "visualIdentities",
  product_visual_link: "productVisualLinks",
} as const;
export function serializeVisualEntity(kind: VisualEntityType, row: unknown) {
  if (!row || typeof row !== "object") throw Error("VISUAL_RECORD_INVALID");
  const { _id, ...entity } = row as Record<string, unknown>;
  void _id;
  return visualEntitySchemas[kind].parse(entity);
}
export class VisualParentPendingError extends Error {}
export async function applyVisualCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  kind: VisualEntityType,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
  actorId?: string,
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Ce visuel n’a pas pu être enregistré. Relisez la fiche, les droits et la validation de l’image.",
        retryable: false,
        requestId,
      },
    },
  });
  const membership = actorId
    ? await ctx.database
        .collection("storeMemberships")
        .findOne(
          { userId: actorId, storeId, active: true, role: "MANAGER" },
          { session: ctx.session },
        )
    : null;
  if (!membership) return reject("VISUAL_ACCESS_INVALID");
  const parsed = visualEntitySchemas[kind].safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.type !== `${kind.toUpperCase()}_UPSERT`
  )
    return reject("VISUAL_COMMAND_INVALID");
  if (kind !== "visual_identity") {
    const value = parsed.data,
      key =
        "contentHash" in value
          ? value.contentHash
          : "productId" in value
            ? value.productId
            : "";
    if (
      value.id !==
      visualIdFromDigest(
        createHash("sha256")
          .update(visualIdMaterial(kind, storeId, key))
          .digest("hex"),
      )
    )
      return reject("VISUAL_ID_INVALID");
  }
  const collection = ctx.database.collection<Document & { _id: string }>(
    visualCollections[kind],
  );
  const row = await collection.findOne(
    { _id: command.entityId },
    { session: ctx.session },
  );
  if (row && row.storeId !== storeId) return reject("VISUAL_SCOPE_INVALID");
  const previous = row ? serializeVisualEntity(kind, row) : null;
  if ((command.expectedRemoteVersion ?? null) !== (previous?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: previous?.version ?? null,
      responseJson: {
        ...(previous ? { remoteEntity: previous } : {}),
        error: {
          code: "VISUAL_VERSION_CONFLICT",
          messageFr:
            "Cette image ou son association a changé sur un autre appareil. Votre choix local est conservé.",
          retryable: false,
          requestId,
        },
      },
    };
  let value: ReturnType<typeof serializeVisualEntity>;
  try {
    value = validateVisualMutation(kind, previous, parsed.data, {
      storeId,
      actorId: actorId!,
      canWrite: true,
    });
  } catch (reason) {
    return reject(
      reason instanceof Error ? reason.message : "VISUAL_COMMAND_INVALID",
    );
  }
  if (kind === "visual_asset" && "contentHash" in value) {
    const duplicate = await collection.findOne(
      { storeId, contentHash: value.contentHash, _id: { $ne: value.id } },
      { session: ctx.session },
    );
    if (duplicate) return reject("VISUAL_BINARY_EXISTS");
  }
  const readParent = async (name: string, id: string) => {
    const record = await ctx.database
      .collection<Document & { _id: string }>(name)
      .findOne({ _id: id }, { session: ctx.session });
    if (record && record.storeId !== storeId)
      throw Error("VISUAL_TARGET_UNAVAILABLE");
    if (record?.deletedAt) throw Error("VISUAL_TARGET_UNAVAILABLE");
    if (!record) throw new VisualParentPendingError("VISUAL_PARENT_PENDING");
    return record;
  };
  try {
    if (
      kind === "visual_identity" &&
      !value.deletedAt &&
      "primaryAssetId" in value &&
      value.primaryAssetId
    )
      await readParent("visualAssets", value.primaryAssetId);
    if (
      kind === "product_visual_link" &&
      !value.deletedAt &&
      "productId" in value
    ) {
      const product = await readParent("products", value.productId);
      const identity = serializeVisualEntity(
        "visual_identity",
        await readParent("visualIdentities", value.visualIdentityId),
      );
      if (
        product.deletedAt ||
        product.status === "INACTIVE" ||
        identity.deletedAt
      )
        return reject("VISUAL_TARGET_UNAVAILABLE");
      if (!("primaryAssetId" in identity))
        return reject("VISUAL_TARGET_UNAVAILABLE");
      const assetId = value.overrideAssetId ?? identity.primaryAssetId;
      if (value.verification === "APPROVED") {
        if (!assetId) return reject("VISUAL_ASSET_UNAVAILABLE");
        const asset = serializeVisualEntity(
          "visual_asset",
          await readParent("visualAssets", assetId),
        );
        if (
          !("review" in asset) ||
          asset.deletedAt ||
          asset.review.status !== "APPROVED"
        )
          return reject("VISUAL_ASSET_UNAVAILABLE");
      }
      const duplicate = await collection.findOne(
        {
          storeId,
          productId: value.productId,
          deletedAt: null,
          _id: { $ne: value.id },
        },
        { session: ctx.session },
      );
      if (!value.deletedAt && duplicate) return reject("VISUAL_LINK_EXISTS");
    }
  } catch (reason) {
    if (reason instanceof VisualParentPendingError) throw reason;
    return reject("VISUAL_TARGET_UNAVAILABLE");
  }
  await collection.replaceOne(
    { _id: value.id, storeId },
    { ...value, _id: value.id },
    { upsert: true, session: ctx.session },
  );
  await ctx.database.collection("visualLibraryHistory").insertOne(
    {
      storeId,
      entityType: kind,
      entityId: value.id,
      version: value.version,
      commandId: command.commandId,
      actorId,
      entity: value,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: kind,
    entityId: value.id,
    entityVersion: value.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: value.version,
    responseJson: { remoteEntity: value },
  };
}
