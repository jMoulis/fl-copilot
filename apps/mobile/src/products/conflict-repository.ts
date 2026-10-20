import {
  catalogueConflictSchemas,
  catalogueConflictTables,
  catalogueConflictTypes,
  catalogueConflictIdentity,
  rebaseCatalogueConflict,
  normalizeProductLabel,
  productSchema,
  productAliasSchema,
  productIdentifierSchema,
  identityReviewAliasReadiness,
  IDENTITY_REVIEW_PRODUCT_LIMIT,
  type CatalogueConflictKind,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { ProductMasterRepository } from "./product-master-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { applyProductMasterChange } from "./apply-product-master";
import { recordProductMasterRemote } from "./remote-snapshot";
import { queueProductRecomputation } from "./recomputation";
function joined(db: OutboxDatabase) {
  return {
    getFirstAsync: db.getFirstAsync.bind(db),
    getAllAsync: db.getAllAsync.bind(db),
    runAsync: db.runAsync.bind(db),
    withExclusiveTransactionAsync: (
      task: (tx: OutboxDatabase) => Promise<void>,
    ) => task(db),
  };
}
export async function readCatalogueConflictCurrent(
  db: OutboxDatabase,
  storeId: string,
  kind: CatalogueConflictKind,
  id: string,
) {
  const repo = new ProductMasterRepository(joined(db)),
    record =
      kind === "PRODUCT"
        ? await repo.getProduct(id)
        : kind === "IDENTIFIER"
          ? await repo.getIdentifier(id)
          : await repo.getAlias(id);
  if (!record || record.entity.storeId !== storeId) return null;
  const snapshot = await db.getFirstAsync<{
    version: number;
    operation: string;
    payload_json: string | null;
  }>(
    "SELECT version,operation,payload_json FROM product_master_remote_snapshots WHERE store_id=? AND entity_type=? AND entity_id=?",
    storeId,
    catalogueConflictTypes[kind],
    id,
  );
  return {
    ...record,
    remoteVersion:
      Math.max(record.remoteVersion ?? 0, snapshot?.version ?? 0) || null,
    remote:
      snapshot?.operation === "UPSERT" && snapshot.payload_json
        ? catalogueConflictSchemas[kind].parse(
            JSON.parse(snapshot.payload_json),
          )
        : null,
    snapshot,
  };
}
export async function readCatalogueConflictPolicy(
  db: OutboxDatabase,
  kind: CatalogueConflictKind,
  rawLocal: unknown,
  rawRemote: unknown,
) {
  const l = catalogueConflictSchemas[kind].parse(rawLocal),
    parsed = catalogueConflictSchemas[kind].safeParse(rawRemote),
    r = parsed.success ? parsed.data : null,
    result = {
      identityValid: !!r && catalogueConflictIdentity(kind, l, r),
      canKeep: false,
      canAdopt: false,
      reactivateLocal: false,
      reactivateRemote: false,
      activateLocal: false,
      activateRemote: false,
      remoteDeleted: !!r?.deletedAt,
      localDeleted: !!l.deletedAt,
      reason: null as string | null,
      snapshots: [] as unknown[],
      products: {} as Record<string, string>,
    };
  if (!r) return result;
  result.canAdopt = result.identityValid;
  if (kind === "PRODUCT" && !r.deletedAt) {
    const local = productSchema.parse(l),
      remote = productSchema.parse(r);
    result.activateLocal =
      remote.status === "INACTIVE" && local.status !== "INACTIVE";
    result.activateRemote =
      local.status === "INACTIVE" && remote.status !== "INACTIVE";
  } else if (kind === "ALIAS" && !r.deletedAt) {
    const local = productAliasSchema.parse(l),
      remote = productAliasSchema.parse(r);
    result.reactivateLocal =
      remote.status === "REJECTED" && local.status !== "REJECTED";
    result.reactivateRemote =
      local.status === "REJECTED" && remote.status !== "REJECTED";
  }
  const repo = new ProductMasterRepository(joined(db));
  let parentClear = true;
  if ("productId" in l) {
    const parent = await repo.getProduct(l.productId);
    result.snapshots.push(parent);
    parentClear =
      !!parent &&
      parent.entity.storeId === l.storeId &&
      parent.entity.status === "ACTIVE" &&
      !parent.entity.deletedAt &&
      !["CONFLICT", "ERROR"].includes(parent.syncState);
    if (parent?.entity.storeId === l.storeId)
      result.products[parent.entity.id] = parent.entity.label;
  }
  let collision = false;
  if (kind === "IDENTIFIER" && !l.deletedAt) {
    const local = productIdentifierSchema.parse(l);
    const duplicates = await db.getAllAsync<{ id: string; product_id: string }>(
      "SELECT id,product_id FROM product_identifiers WHERE store_id=? AND id!=? AND type=? AND value=? AND deleted_at IS NULL ORDER BY id LIMIT 101",
      local.storeId,
      local.id,
      local.type,
      local.value,
    );
    result.snapshots.push(duplicates);
    collision = duplicates.length > 0;
  } else if (
    !l.deletedAt &&
    (kind === "PRODUCT" ||
      (kind === "ALIAS" && productAliasSchema.parse(l).status === "VALIDATED"))
  ) {
    const label =
        kind === "PRODUCT"
          ? productSchema.parse(l).label
          : productAliasSchema.parse(l).alias,
      productId =
        kind === "PRODUCT" ? l.id : productAliasSchema.parse(l).productId;
    const products = await db.getAllAsync<{
        id: string;
        label: string;
        version: number;
        sync_state: string;
      }>(
        "SELECT id,label,version,sync_state FROM products WHERE store_id=? AND status='ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT ?",
        l.storeId,
        IDENTITY_REVIEW_PRODUCT_LIMIT + 1,
      ),
      aliases = await db.getAllAsync<{
        id: string;
        product_id: string;
        version: number;
        sync_state: string;
      }>(
        "SELECT id,product_id,version,sync_state FROM product_aliases WHERE store_id=? AND product_id!=? AND normalized_alias=? AND status='VALIDATED' AND deleted_at IS NULL ORDER BY id LIMIT 101",
        l.storeId,
        productId,
        normalizeProductLabel(label),
      );
    result.snapshots.push(products, aliases);
    collision =
      identityReviewAliasReadiness(
        productId,
        normalizeProductLabel(label),
        aliases.length > 0,
        products,
      ) !== "READY";
  }
  // Keeping a local tombstone deletes only this same identity; it does not reactivate
  // its status, require an active parent or publish conflicting label/code edits.
  if (l.deletedAt) {
    result.activateLocal = false;
    result.reactivateLocal = false;
  }
  result.canKeep =
    result.identityValid &&
    !r.deletedAt &&
    (!!l.deletedAt || (parentClear && !collision));
  if (!result.identityValid)
    result.reason =
      "L’association désigne une autre fiche ou une autre origine. Aucune identité n’est réaffectée automatiquement.";
  else if (r.deletedAt)
    result.reason =
      "Cette donnée a été supprimée dans la version synchronisée. Vous pouvez accepter cette suppression après comparaison ; votre saisie et les commandes antérieures restent conservées sur cet appareil pour traçabilité. Aucune réactivation automatique n’est proposée.";
  else if (l.deletedAt)
    result.reason =
      "Vous avez supprimé cette donnée sur cet appareil, mais sa version synchronisée a été modifiée. Comparez-les puis choisissez de maintenir votre suppression ou de l’annuler. Les autres fiches et les chiffres publiés restent inchangés.";
  else if (collision)
    result.reason =
      "Le libellé ou le code est déjà utilisé par une autre fiche, ou le contrôle complet dépasse sa limite. Vérifiez le référentiel avant de renvoyer cette version.";
  else if (!parentClear)
    result.reason =
      "Le produit associé doit être actif et sans erreur de synchronisation avant de renvoyer cette identité.";
  return result;
}
export class ProductMasterConflictRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
  ) {}
  async review(storeId: string, conflictId: string) {
    const conflict = await new ConflictRepository(this.db).getById(conflictId);
    if (!conflict || conflict.storeId !== storeId || conflict.status !== "OPEN")
      throw Error("CATALOGUE_CONFLICT_UNAVAILABLE");
    const kind = (
      Object.keys(catalogueConflictTypes) as CatalogueConflictKind[]
    ).find((k) => catalogueConflictTypes[k] === conflict.entityType);
    if (!kind) throw Error("CATALOGUE_CONFLICT_KIND");
    const current = await readCatalogueConflictCurrent(
        this.db,
        storeId,
        kind,
        conflict.entityId,
      ),
      remote = catalogueConflictSchemas[kind].parse(conflict.remotePayload);
    if (
      !current ||
      remote.storeId !== storeId ||
      remote.id !== conflict.entityId ||
      remote.version !== conflict.remoteVersion
    )
      throw Error("CATALOGUE_CONFLICT_SCOPE");
    const commands = await this.db.getAllAsync<{
        command_id: string;
        status: string;
        payload_json: string;
        expected_remote_version: number | null;
      }>(
        "SELECT command_id,status,payload_json,expected_remote_version FROM sync_outbox WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','SYNCING','FAILED','CONFLICT') ORDER BY local_sequence LIMIT 101",
        storeId,
        conflict.entityType,
        conflict.entityId,
      ),
      open = await this.db.getAllAsync<{ id: string }>(
        "SELECT id FROM sync_conflicts WHERE store_id=? AND entity_type=? AND entity_id=? AND status='OPEN' ORDER BY id LIMIT 2",
        storeId,
        conflict.entityType,
        conflict.entityId,
      ),
      policy = await readCatalogueConflictPolicy(
        this.db,
        kind,
        current.entity,
        remote,
      );
    const blocked =
      current.syncState !== "CONFLICT" ||
      open.length !== 1 ||
      commands.length > 100 ||
      commands.some((c) => c.status === "SYNCING") ||
      (current.remoteVersion ?? 0) > remote.version ||
      (!!current.snapshot &&
        current.snapshot.version >= remote.version &&
        (current.snapshot.operation === "DELETE"
          ? !remote.deletedAt || current.snapshot.version !== remote.version
          : (await this.digest(JSON.stringify(current.remote))) !==
            (await this.digest(JSON.stringify(remote)))));
    const hash = await this.digest(
      JSON.stringify({
        conflict,
        current,
        commands,
        open,
        parents: policy.snapshots,
      }),
    );
    return {
      kind,
      current,
      remote,
      conflict,
      policy,
      hash,
      canKeep: !blocked && policy.canKeep,
      canAdopt: !blocked && policy.canAdopt,
      reason: blocked
        ? "La comparaison a changé ou un envoi est en cours. Synchronisez puis relisez les versions."
        : policy.reason,
    };
  }
  async resolve(
    storeId: string,
    conflictId: string,
    useLocal: boolean,
    ctx: {
      commandId: string;
      deviceId: string;
      reviewHash: string;
      reactivateRejected?: boolean;
      activateProduct?: boolean;
      acceptRemoteDeletion?: boolean;
      confirmLocalDeletionChoice?: boolean;
      jobId: string;
      canResolve: () => boolean;
      signal?: AbortSignal;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("CATALOGUE_CONFLICT_FORBIDDEN");
      const review = await new ProductMasterConflictRepository(
          joined(tx),
          this.digest,
        ).review(storeId, conflictId),
        { kind, current, remote, conflict, policy } = review;
      if (
        review.hash !== ctx.reviewHash ||
        !(useLocal ? review.canKeep : review.canAdopt)
      )
        throw Error("CATALOGUE_CONFLICT_STALE");
      if (
        (useLocal ? policy.reactivateLocal : policy.reactivateRemote) &&
        !ctx.reactivateRejected
      )
        throw Error("CATALOGUE_CONFLICT_REACTIVATION_REQUIRED");
      if (
        (useLocal ? policy.activateLocal : policy.activateRemote) &&
        !ctx.activateProduct
      )
        throw Error("CATALOGUE_CONFLICT_ACTIVATION_REQUIRED");
      if (!useLocal && policy.remoteDeleted && !ctx.acceptRemoteDeletion)
        throw Error("CATALOGUE_CONFLICT_DELETION_CONFIRMATION_REQUIRED");
      if (
        policy.localDeleted &&
        !policy.remoteDeleted &&
        !ctx.confirmLocalDeletionChoice
      )
        throw Error("CATALOGUE_CONFLICT_LOCAL_DELETION_CONFIRMATION_REQUIRED");
      const now = new Date().toISOString(),
        after = useLocal
          ? policy.localDeleted
            ? catalogueConflictSchemas[kind].parse({
                ...remote,
                version: remote.version + 1,
                updatedAt: now,
                deletedAt: now,
              })
            : rebaseCatalogueConflict(kind, current.entity, remote, now)
          : remote;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='PRODUCT_MASTER_CONFLICT_SUPERSEDED' WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','FAILED','CONFLICT')",
        storeId,
        conflict.entityType,
        conflict.entityId,
      );
      await recordProductMasterRemote(
        tx,
        storeId,
        conflict.entityType,
        remote.id,
        remote.version,
        remote.deletedAt ? "DELETE" : "UPSERT",
        remote.deletedAt ? null : remote,
      );
      if (useLocal) {
        const repo = new ProductMasterRepository(joined(tx)),
          context = {
            commandId: ctx.commandId,
            deviceId: ctx.deviceId,
            expectedRemoteVersion: remote.version,
          };
        if (policy.localDeleted) {
          // The canonical DELETE writer requires a live baseline. Installing the reviewed
          // remote row and enqueuing its deletion are in this same exclusive transaction.
          await applyProductMasterChange(
            tx,
            storeId,
            {
              entityType: conflict.entityType,
              entityId: remote.id,
              entityVersion: remote.version,
              operation: "UPSERT",
              entity: remote,
            },
            current.entity.version,
          );
          await repo.delete(
            catalogueConflictTypes[kind],
            remote.id,
            storeId,
            now,
            context,
          );
        } else if (kind === "PRODUCT")
          await repo.upsertProduct(productSchema.parse(after), context);
        else if (kind === "IDENTIFIER")
          await repo.upsertIdentifier(
            productIdentifierSchema.parse(after),
            context,
          );
        else await repo.upsertAlias(productAliasSchema.parse(after), context);
        await tx.runAsync(
          `UPDATE ${catalogueConflictTables[kind]} SET remote_version=?,created_at=? WHERE store_id=? AND id=?`,
          remote.version,
          remote.createdAt,
          storeId,
          remote.id,
        );
      } else
        await applyProductMasterChange(
          tx,
          storeId,
          {
            entityType: conflict.entityType,
            entityId: remote.id,
            entityVersion: remote.version,
            operation: "UPSERT",
            entity: remote,
          },
          current.entity.version,
        );
      await tx.runAsync(
        "INSERT INTO product_master_conflict_history(action_id,store_id,entity_type,entity_id,local_json,remote_json,resolved_json,decision,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ctx.commandId,
        storeId,
        conflict.entityType,
        remote.id,
        JSON.stringify(current.entity),
        JSON.stringify(remote),
        JSON.stringify(after),
        useLocal ? "KEEP_LOCAL" : "ADOPT_REMOTE",
        now,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        conflictId,
        storeId,
      );
      await queueProductRecomputation(
        tx,
        storeId,
        "productId" in after ? after.productId : after.id,
        ctx.jobId,
        now,
      );
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("CATALOGUE_CONFLICT_FORBIDDEN");
    });
  }
}
