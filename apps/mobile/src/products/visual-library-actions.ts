import { z } from "zod";
import {
  catalogueSnapshotIdentity,
  visualAssetSchema,
  visualIdentitySchema,
  productVisualLinkSchema,
  type VisualIdentity,
  type ProductVisualLink,
} from "@fl-copilot/domain";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "./product-master-repository";
import {
  loadProductEditorSnapshot,
  type ProductEditorSnapshot,
} from "./product-editor-service";
import {
  VisualLibraryRepository,
  type LocalVisualRecord,
} from "./visual-library-repository";
import { VisualFileCache, type VerifiedVisualFile } from "./visual-file-cache";
import type { VisualAsset } from "@fl-copilot/domain";
import { enqueueVisualFileJob } from "./visual-file-jobs";
type Database = OutboxDatabase & AtomicMutationDatabase;
export interface VisualActionContext {
  storeId: string;
  actorId: string;
  deviceId: string;
  canWrite(): boolean;
  id(): string;
  now(): string;
}
export type VisualSelectionBasis = {
  product: ProductEditorSnapshot;
  link: LocalVisualRecord<ProductVisualLink> | null;
};
export interface CapturedVisualSource extends VerifiedVisualFile {
  mimeType: VisualAsset["mimeType"];
  width: number;
  height: number;
}
const fingerprint = (r: LocalVisualRecord<unknown> | null) =>
  r
    ? JSON.stringify({
        entity: r.entity,
        syncState:
          r.syncState === "ERROR" || r.syncState === "CONFLICT"
            ? r.syncState
            : null,
      })
    : null;
export async function readProductVisualLink(
  repo: VisualLibraryRepository,
  storeId: string,
  productId: string,
) {
  const links = (await repo.list("product_visual_link", storeId)).filter(
    (r) => r.entity.productId === productId && !r.entity.deletedAt,
  );
  if (links.length > 1) throw Error("VISUAL_LINK_CONFLICT");
  return links[0] ?? null;
}
async function target(
  tx: OutboxDatabase,
  basis: VisualSelectionBasis,
  ctx: VisualActionContext,
) {
  if (!ctx.canWrite()) throw Error("VISUAL_ACCESS_INVALID");
  const db = joinedMutationDatabase(tx),
    repo = new VisualLibraryRepository(db),
    product = await loadProductEditorSnapshot(
      new ProductMasterRepository(db),
      basis.product.product.entity.id,
    );
  if (
    !product ||
    product.product.entity.storeId !== ctx.storeId ||
    product.product.entity.status === "INACTIVE" ||
    ["ERROR", "CONFLICT"].includes(product.product.syncState)
  )
    throw Error("VISUAL_TARGET_UNAVAILABLE");
  if (
    catalogueSnapshotIdentity(product) !==
    catalogueSnapshotIdentity(basis.product)
  )
    throw Error("VISUAL_PRODUCT_CHANGED");
  const conflict = await tx.getFirstAsync<{ id: string }>(
    "SELECT c.id FROM sync_conflicts c LEFT JOIN product_identifiers pi ON c.entity_type='product_identifier' AND pi.id=c.entity_id LEFT JOIN product_aliases pa ON c.entity_type='product_alias' AND pa.id=c.entity_id WHERE c.store_id=? AND c.status='OPEN' AND ((c.entity_type='product' AND c.entity_id=?) OR (c.entity_type='product_identifier' AND pi.product_id=?) OR (c.entity_type='product_alias' AND pa.product_id=?)) LIMIT 1",
    ctx.storeId,
    product.product.entity.id,
    product.product.entity.id,
    product.product.entity.id,
  );
  if (conflict) throw Error("VISUAL_TARGET_UNAVAILABLE");
  const link = await readProductVisualLink(
    repo,
    ctx.storeId,
    product.product.entity.id,
  );
  if (fingerprint(link) !== fingerprint(basis.link))
    throw Error("VISUAL_SELECTION_CHANGED");
  if (link && ["ERROR", "CONFLICT"].includes(link.syncState))
    throw Error("VISUAL_RESOLVE_REQUIRED");
  return { db, repo, product, link };
}
function base(ctx: VisualActionContext, at: string) {
  return {
    id: ctx.id(),
    storeId: ctx.storeId,
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}
function mutation(ctx: VisualActionContext, version: number | null) {
  return {
    storeId: ctx.storeId,
    actorId: ctx.actorId,
    deviceId: ctx.deviceId,
    commandId: ctx.id(),
    expectedLocalVersion: version,
    canWrite: ctx.canWrite(),
  };
}
function nextLink(
  ctx: VisualActionContext,
  at: string,
  old: LocalVisualRecord<ProductVisualLink> | null,
  productId: string,
  identity: VisualIdentity,
  assetId: string | null,
) {
  return productVisualLinkSchema.parse({
    ...base(ctx, at),
    ...(old
      ? {
          id: old.entity.id,
          createdBy: old.entity.createdBy,
          createdAt: old.entity.createdAt,
          version: old.entity.version + 1,
        }
      : {}),
    productId,
    visualIdentityId: identity.id,
    overrideAssetId: assetId,
    linkType: assetId
      ? "MANUAL_OVERRIDE"
      : identity.specificity === "PACKAGED_EXACT"
        ? "EXACT"
        : "INHERITED_GENERIC",
    verification: "APPROVED",
    verifiedBy: ctx.actorId,
    verifiedAt: at,
  });
}
/** UI has explicitly confirmed both the photo and its rights before this local transaction. */
export async function assignCapturedVisual(
  db: Database,
  basis: VisualSelectionBasis,
  source: CapturedVisualSource,
  rightsConfirmed: boolean,
  ctx: VisualActionContext,
) {
  if (!rightsConfirmed) throw Error("VISUAL_RIGHTS_REQUIRED");
  z.uuid().parse(ctx.actorId);
  let result: VisualAsset | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await target(tx, basis, ctx),
      at = ctx.now();
    const known = (await current.repo.list("visual_asset", ctx.storeId)).find(
      (r) => r.entity.contentHash === source.contentHash,
    );
    let asset = known?.entity;
    if (
      known &&
      (known.entity.deletedAt ||
        known.entity.review.status !== "APPROVED" ||
        known.remote?.deletedAt ||
        known.remote?.review.status === "REVOKED" ||
        ["ERROR", "CONFLICT"].includes(known.syncState) ||
        (known.dirty && known.entity.updatedBy !== ctx.actorId))
    )
      throw Error("VISUAL_ASSET_UNAVAILABLE");
    if (!asset) {
      asset = visualAssetSchema.parse({
        ...base(ctx, at),
        contentHash: source.contentHash,
        mimeType: source.mimeType,
        width: source.width,
        height: source.height,
        sizeBytes: source.sizeBytes,
        provenance: {
          type: "USER_UPLOAD",
          rights: "USER_CONFIRMED",
          confirmedBy: ctx.actorId,
          confirmedAt: at,
        },
        review: { status: "APPROVED", actorId: ctx.actorId, at },
      });
      await current.repo.save("visual_asset", asset, mutation(ctx, null));
    }
    const cache = new VisualFileCache(current.db);
    await cache.remember(ctx.storeId, asset.id, "SOURCE", source);
    const priorIdentity = (
      await current.repo.list("visual_identity", ctx.storeId)
    ).find(
      (r) =>
        !r.entity.deletedAt &&
        r.entity.primaryAssetId === asset.id &&
        r.entity.specificity ===
          (current.product.product.entity.nature === "PACKAGED"
            ? "PACKAGED_EXACT"
            : "GENERIC") &&
        !["ERROR", "CONFLICT"].includes(r.syncState),
    );
    let identity = priorIdentity?.entity;
    if (!identity) {
      identity = visualIdentitySchema.parse({
        ...base(ctx, at),
        canonicalName: current.product.product.entity.label,
        specificity:
          current.product.product.entity.nature === "PACKAGED"
            ? "PACKAGED_EXACT"
            : "GENERIC",
        variety: null,
        appearance: null,
        brand: null,
        primaryAssetId: asset.id,
      });
      await current.repo.save("visual_identity", identity, mutation(ctx, null));
    }
    const link = nextLink(
      ctx,
      at,
      current.link,
      current.product.product.entity.id,
      identity,
      asset.id,
    );
    await current.repo.save(
      "product_visual_link",
      link,
      mutation(ctx, current.link?.entity.version ?? null),
    );
    const retained = await cache.get(ctx.storeId, asset, "SOURCE");
    if (!retained?.uploaded)
      await enqueueVisualFileJob(
        tx,
        {
          storeId: ctx.storeId,
          ownerId: ctx.actorId,
          assetId: asset.id,
          sourceHash: asset.contentHash,
          variant: "UPLOAD",
        },
        ctx.id,
        at,
        true,
      );
    if (!ctx.canWrite()) throw Error("VISUAL_ACCESS_INVALID");
    result = asset;
  });
  return result!;
}
export async function assignLibraryVisual(
  db: Database,
  basis: VisualSelectionBasis,
  selected: LocalVisualRecord<VisualIdentity>,
  ctx: VisualActionContext,
) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await target(tx, basis, ctx),
      identity = await current.repo.get(
        "visual_identity",
        ctx.storeId,
        selected.entity.id,
      ),
      at = ctx.now();
    if (
      !identity ||
      (identity.dirty && identity.entity.updatedBy !== ctx.actorId) ||
      fingerprint(identity) !== fingerprint(selected) ||
      identity.entity.deletedAt ||
      ["CONFLICT", "ERROR"].includes(identity.syncState)
    )
      throw Error("VISUAL_SELECTION_CHANGED");
    const asset = identity.entity.primaryAssetId
      ? await current.repo.get(
          "visual_asset",
          ctx.storeId,
          identity.entity.primaryAssetId,
        )
      : null;
    if (
      !asset ||
      asset.entity.deletedAt ||
      asset.entity.review.status !== "APPROVED" ||
      asset.remote?.deletedAt ||
      ["REJECTED", "REVOKED"].includes(asset.remote?.review.status ?? "") ||
      ["CONFLICT", "ERROR"].includes(asset.syncState)
    )
      throw Error("VISUAL_ASSET_UNAVAILABLE");
    if (
      identity.entity.specificity === "PACKAGED_EXACT" &&
      asset.entity.provenance.type === "AI_GENERATED"
    )
      throw Error("VISUAL_SELECTION_INVALID");
    const link = nextLink(
      ctx,
      at,
      current.link,
      current.product.product.entity.id,
      identity.entity,
      null,
    );
    await current.repo.save(
      "product_visual_link",
      link,
      mutation(ctx, current.link?.entity.version ?? null),
    );
    if (!ctx.canWrite()) throw Error("VISUAL_ACCESS_INVALID");
  });
}
export async function removeProductVisual(
  db: Database,
  basis: VisualSelectionBasis,
  ctx: VisualActionContext,
) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const { repo, link } = await target(tx, basis, ctx);
    if (!link) return;
    const at = ctx.now();
    await repo.save(
      "product_visual_link",
      {
        ...link.entity,
        version: link.entity.version + 1,
        updatedBy: ctx.actorId,
        updatedAt: at,
        deletedAt: at,
        verifiedBy: ctx.actorId,
        verifiedAt: at,
      },
      mutation(ctx, link.entity.version),
    );
  });
}

/** Explicit takedown stops distribution; the retained original is never deleted. */
export async function revokeLibraryVisual(
  db: Database,
  expected: LocalVisualRecord<VisualAsset>,
  ctx: VisualActionContext,
) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!ctx.canWrite()) throw Error("VISUAL_ACCESS_INVALID");
    const repo = new VisualLibraryRepository(joinedMutationDatabase(tx));
    const current = await repo.get(
      "visual_asset",
      ctx.storeId,
      expected.entity.id,
    );
    if (!current || fingerprint(current) !== fingerprint(expected))
      throw Error("VISUAL_SELECTION_CHANGED");
    const at = ctx.now();
    await repo.save(
      "visual_asset",
      {
        ...current.entity,
        version: current.entity.version + 1,
        updatedAt: at,
        updatedBy: ctx.actorId,
        review: { status: "REVOKED", actorId: ctx.actorId, at },
      },
      mutation(ctx, current.entity.version),
    );
    await tx.runAsync(
      "UPDATE local_jobs SET status='CANCELLED',last_error='VISUAL_REVOKED',next_attempt_at=NULL,updated_at=? WHERE type='VISUAL_FILE_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.assetId')=? AND status IN ('PENDING','RETRY','RUNNING','FAILED')",
      at,
      ctx.storeId,
      current.entity.id,
    );
    if (!ctx.canWrite()) throw Error("VISUAL_ACCESS_INVALID");
  });
}

export async function loadVisualSelectionBasis(
  db: Database,
  productId: string,
  ctx: VisualActionContext,
): Promise<VisualSelectionBasis> {
  let result: VisualSelectionBasis | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!ctx.canWrite()) throw Error("VISUAL_ACCESS_INVALID");
    const joined = joinedMutationDatabase(tx),
      product = await loadProductEditorSnapshot(
        new ProductMasterRepository(joined),
        productId,
      );
    if (!product || product.product.entity.storeId !== ctx.storeId)
      throw Error("VISUAL_TARGET_UNAVAILABLE");
    result = {
      product,
      link: await readProductVisualLink(
        new VisualLibraryRepository(joined),
        ctx.storeId,
        productId,
      ),
    };
    await target(tx, result, ctx);
  });
  return result!;
}
