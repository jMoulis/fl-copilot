import { z } from "zod";
import {
  isVisualEntityType,
  visualEntitySchemas,
  rebaseVisualChoice,
  visualReactivationRequired,
  type VisualEntityMap,
  type VisualEntityType,
  type VisualAsset,
} from "@fl-copilot/domain";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import {
  notifyOutboxChanged,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ProductMasterRepository } from "./product-master-repository";
import {
  VisualLibraryRepository,
  applyVisualEntity,
  visualTables,
} from "./visual-library-repository";
import { assertCanonicalVisualId } from "./visual-id";

type Database = OutboxDatabase & AtomicMutationDatabase;
type Entity = VisualEntityMap[VisualEntityType];
const SUPERSEDED = "VISUAL_LIBRARY_SUPERSEDED";

export async function readVisualParents(
  db: OutboxDatabase,
  entity: Entity,
  actorId: string,
) {
  const repo = new VisualLibraryRepository(joinedMutationDatabase(db));
  const snapshots: unknown[] = [];
  const labels: Record<string, string> = {};
  let clear = true;
  let preview: VisualAsset | null = "contentHash" in entity ? entity : null;
  if (entity.deletedAt) return { clear, snapshots, labels, preview };
  const usable = (r: Awaited<ReturnType<typeof repo.get>>) =>
    !!r &&
    !r.entity.deletedAt &&
    !r.remote?.deletedAt &&
    (!r.remote || r.remote.version <= (r.remoteVersion ?? 0)) &&
    !["ERROR", "CONFLICT"].includes(r.syncState) &&
    !(r.dirty && r.entity.updatedBy !== actorId);
  let assetId: string | null =
    "primaryAssetId" in entity ? entity.primaryAssetId : null;
  if ("productId" in entity) {
    const product = await new ProductMasterRepository(
      joinedMutationDatabase(db),
    ).getProduct(entity.productId);
    snapshots.push(product);
    const productRemote = await db.getFirstAsync<{
      version: number;
      operation: string;
      payload_json: string | null;
    }>(
      "SELECT version,operation,payload_json FROM product_master_remote_snapshots WHERE store_id=? AND entity_type='product' AND entity_id=?",
      entity.storeId,
      entity.productId,
    );
    snapshots.push(productRemote);
    if (product?.entity.storeId === entity.storeId)
      labels[entity.productId] = product.entity.label;
    clear =
      !!product &&
      product.entity.storeId === entity.storeId &&
      !product.entity.deletedAt &&
      product.entity.status === "ACTIVE" &&
      !["ERROR", "CONFLICT"].includes(product.syncState) &&
      (!productRemote ||
        (productRemote.operation !== "DELETE" &&
          productRemote.version <= (product.remoteVersion ?? 0)));
    const identity = await repo.get(
      "visual_identity",
      entity.storeId,
      entity.visualIdentityId,
    );
    snapshots.push(identity);
    if (identity) labels[identity.entity.id] = identity.entity.canonicalName;
    clear &&= usable(identity);
    assetId = entity.overrideAssetId ?? identity?.entity.primaryAssetId ?? null;
  }
  if (assetId) {
    const asset = await repo.get("visual_asset", entity.storeId, assetId);
    preview = asset?.entity ?? null;
    snapshots.push(asset);
    clear &&=
      usable(asset) &&
      asset?.entity.review.status === "APPROVED" &&
      !["REJECTED", "REVOKED"].includes(asset?.remote?.review.status ?? "");
  } else if ("verification" in entity && entity.verification === "APPROVED")
    clear = false;
  return { clear, snapshots, labels, preview };
}

export class VisualConflictRepository {
  constructor(
    private db: Database,
    private digest: (s: string) => Promise<string>,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  async review(storeId: string, conflictId: string, actorId: string) {
    z.uuid().parse(actorId);
    const conflict = await new ConflictRepository(this.db).getById(conflictId);
    if (
      !conflict ||
      conflict.storeId !== storeId ||
      conflict.status !== "OPEN" ||
      !isVisualEntityType(conflict.entityType)
    )
      throw Error("VISUAL_CONFLICT_SCOPE");
    const kind = conflict.entityType;
    const current = await new VisualLibraryRepository(this.db).get(
      kind,
      storeId,
      conflict.entityId,
    );
    const original = visualEntitySchemas[kind].parse(
      conflict.localPayload,
    ) as Entity;
    const conflictRemote = visualEntitySchemas[kind].parse(
      conflict.remotePayload,
    ) as Entity;
    if (
      !current ||
      original.id !== current.entity.id ||
      original.storeId !== storeId ||
      conflictRemote.id !== current.entity.id ||
      conflictRemote.storeId !== storeId ||
      conflict.remoteVersion !== conflictRemote.version
    )
      throw Error("VISUAL_CONFLICT_SCOPE");
    const remote =
      current.remote && current.remote.version > conflictRemote.version
        ? current.remote
        : conflictRemote;
    await assertCanonicalVisualId(kind, current.entity);
    await assertCanonicalVisualId(kind, remote);
    const commands = await this.db.getAllAsync<{
      command_id: string;
      status: string;
      payload_json: string;
      expected_remote_version: number | null;
      last_error_code: string | null;
    }>(
      "SELECT command_id,status,payload_json,expected_remote_version,last_error_code FROM sync_outbox WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','SYNCING','FAILED','CONFLICT') AND COALESCE(last_error_code,'')<>? ORDER BY local_sequence LIMIT 101",
      storeId,
      kind,
      current.entity.id,
      SUPERSEDED,
    );
    const open = await this.db.getAllAsync<{ id: string }>(
      "SELECT id FROM sync_conflicts WHERE store_id=? AND entity_type=? AND entity_id=? AND status='OPEN' ORDER BY id LIMIT 2",
      storeId,
      kind,
      current.entity.id,
    );
    const localParents = await readVisualParents(
      this.db,
      current.entity,
      actorId,
    );
    const remoteParents = await readVisualParents(this.db, remote, actorId);
    const blocked =
      current.syncState !== "CONFLICT" ||
      !current.dirty ||
      current.entity.updatedBy !== actorId ||
      commands.length === 0 ||
      commands.length > 100 ||
      !commands.some((c) => c.command_id === conflict.commandId) ||
      commands.some(
        (c) =>
          c.status === "SYNCING" ||
          (JSON.parse(c.payload_json) as Entity).updatedBy !== actorId,
      ) ||
      open.length !== 1 ||
      (current.remoteVersion ?? 0) > remote.version ||
      (current.remote?.version === remote.version &&
        JSON.stringify(current.remote) !== JSON.stringify(remote));
    let canRebase = true;
    try {
      rebaseVisualChoice(kind, current.entity, remote, actorId, this.now());
    } catch {
      canRebase = false;
    }
    const hash = await this.digest(
      JSON.stringify({
        actorId,
        conflict,
        current,
        remote,
        commands,
        open,
        parents: [localParents.snapshots, remoteParents.snapshots],
      }),
    );
    return {
      kind,
      conflict,
      current,
      remote,
      commands,
      hash,
      canKeep: !blocked && canRebase && localParents.clear,
      canAdopt: !blocked,
      reactivateLocal: visualReactivationRequired(remote, current.entity),
      reactivateRemote: visualReactivationRequired(current.entity, remote),
      labels: { ...localParents.labels, ...remoteParents.labels },
      previews: { local: localParents.preview, remote: remoteParents.preview },
      reason: blocked
        ? "La comparaison a changé, appartient à un autre compte ou un envoi est en cours. Synchronisez puis relisez les versions."
        : !localParents.clear
          ? "Le choix local dépend d’un produit ou d’un visuel à corriger. La version synchronisée peut être conservée."
          : !canRebase
            ? "Les provenances ne sont pas compatibles. Conservez la version synchronisée ; les deux sources restent enregistrées."
            : null,
    };
  }

  async resolve(
    storeId: string,
    conflictId: string,
    useLocal: boolean,
    ctx: {
      actorId: string;
      commandId: string;
      deviceId: string;
      reviewHash: string;
      reactivate?: boolean;
      rightsConfirmed?: boolean;
      canResolve(): boolean;
      signal?: AbortSignal;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const allowed = () => {
        if (!ctx.canResolve() || ctx.signal?.aborted)
          throw Error("VISUAL_CONFLICT_FORBIDDEN");
      };
      allowed();
      z.uuid().parse(ctx.commandId);
      z.uuid().parse(ctx.deviceId);
      const review = await new VisualConflictRepository(
        joinedMutationDatabase(tx),
        this.digest,
        this.now,
      ).review(storeId, conflictId, ctx.actorId);
      if (
        review.hash !== ctx.reviewHash ||
        !(useLocal ? review.canKeep : review.canAdopt)
      )
        throw Error("VISUAL_CONFLICT_STALE");
      if (
        (useLocal ? review.reactivateLocal : review.reactivateRemote) &&
        !ctx.reactivate
      )
        throw Error("VISUAL_CONFLICT_REACTIVATION_REQUIRED");
      if (
        useLocal &&
        !review.current.entity.deletedAt &&
        "provenance" in review.current.entity &&
        review.current.entity.provenance.type === "USER_UPLOAD" &&
        !ctx.rightsConfirmed
      )
        throw Error("VISUAL_RIGHTS_REQUIRED");
      const at = this.now(),
        { kind, current, remote } = review;
      const after = useLocal
        ? rebaseVisualChoice(kind, current.entity, remote, ctx.actorId, at)
        : remote;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code=? WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','FAILED','CONFLICT') AND COALESCE(last_error_code,'')<>?",
        SUPERSEDED,
        storeId,
        kind,
        current.entity.id,
        SUPERSEDED,
      );
      await tx.runAsync(
        `UPDATE ${visualTables[kind]} SET dirty=0,sync_state='SYNCED' WHERE id=? AND store_id=?`,
        current.entity.id,
        storeId,
      );
      await applyVisualEntity(tx, storeId, kind, remote);
      if (useLocal)
        await new VisualLibraryRepository(joinedMutationDatabase(tx)).save(
          kind,
          after,
          {
            storeId,
            actorId: ctx.actorId,
            deviceId: ctx.deviceId,
            commandId: ctx.commandId,
            expectedLocalVersion: remote.version,
            canWrite: ctx.canResolve(),
          },
        );
      await tx.runAsync(
        "INSERT INTO visual_conflict_history(action_id,store_id,entity_type,entity_id,local_json,remote_json,resolved_json,decision,actor_id,created_at,commands_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ctx.commandId,
        storeId,
        kind,
        remote.id,
        JSON.stringify(current.entity),
        JSON.stringify(remote),
        JSON.stringify(after),
        useLocal ? "KEEP_LOCAL" : "ADOPT_REMOTE",
        ctx.actorId,
        at,
        JSON.stringify(review.commands),
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        at,
        conflictId,
        storeId,
      );
      if (
        after.deletedAt ||
        ("review" in after && after.review.status !== "APPROVED")
      )
        await tx.runAsync(
          "UPDATE local_jobs SET status='CANCELLED',updated_at=? WHERE type='VISUAL_FILE_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.assetId')=? AND status IN ('PENDING','RETRY','FAILED')",
          at,
          storeId,
          ctx.actorId,
          remote.id,
        );
      allowed();
    });
    notifyOutboxChanged();
  }
}
