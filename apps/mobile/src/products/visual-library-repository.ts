import { z } from "zod";
import {
  visualEntitySchemas,
  validateVisualMutation,
  resolveProductVisual,
  type VisualEntityMap,
  type VisualEntityType,
  type Product,
} from "@fl-copilot/domain";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";

export const visualTables = {
  visual_asset: "visual_assets",
  visual_identity: "visual_identities",
  product_visual_link: "product_visual_links",
} as const;
interface Row {
  id: string;
  store_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
}
export interface LocalVisualRecord<T> {
  entity: T;
  remote: T | null;
  remoteVersion: number | null;
  syncState: string;
  dirty: boolean;
}
function mapped<K extends VisualEntityType>(
  kind: K,
  row: Row,
): LocalVisualRecord<VisualEntityMap[K]> {
  const parse = (raw: string) =>
    visualEntitySchemas[kind].parse(JSON.parse(raw)) as VisualEntityMap[K];
  const entity = parse(row.payload_json),
    remote = row.remote_payload_json ? parse(row.remote_payload_json) : null;
  if (
    entity.id !== row.id ||
    entity.storeId !== row.store_id ||
    (remote && (remote.id !== row.id || remote.storeId !== row.store_id))
  )
    throw Error("VISUAL_SCOPE_INVALID");
  return {
    entity,
    remote,
    remoteVersion: row.remote_version,
    syncState: row.sync_state,
    dirty: !!row.dirty,
  };
}
async function writeVisual<K extends VisualEntityType>(
  db: OutboxDatabase,
  kind: K,
  p: VisualEntityMap[K],
  remote: string | null,
  remoteVersion: number | null,
  dirty: boolean,
) {
  const extra =
    kind === "visual_asset"
      ? {
          column: "content_hash",
          value: (p as VisualEntityMap["visual_asset"]).contentHash,
        }
      : null;
  const link =
    kind === "product_visual_link"
      ? (p as VisualEntityMap["product_visual_link"])
      : null;
  const columns = [
    "id",
    "store_id",
    "payload_json",
    "remote_payload_json",
    "remote_version",
    "sync_state",
    "dirty",
    ...(extra ? [extra.column] : []),
    ...(link ? ["product_id", "deleted_at"] : []),
  ];
  const values = [
    p.id,
    p.storeId,
    JSON.stringify(p),
    remote,
    remoteVersion,
    dirty ? "PENDING" : "SYNCED",
    dirty ? 1 : 0,
    ...(extra ? [extra.value] : []),
    ...(link ? [link.productId, link.deletedAt] : []),
  ];
  await db.runAsync(
    `INSERT INTO ${visualTables[kind]}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${columns
      .slice(2)
      .map((c) => `${c}=excluded.${c}`)
      .join(",")}`,
    ...values,
  );
}

export async function applyVisualEntity<K extends VisualEntityType>(
  db: OutboxDatabase,
  storeId: string,
  kind: K,
  raw: unknown,
  ackVersion?: number,
) {
  const p = visualEntitySchemas[kind].parse(raw) as VisualEntityMap[K];
  if (
    p.storeId !== storeId ||
    (ackVersion !== undefined && ackVersion !== p.version)
  )
    throw Error("VISUAL_SCOPE_INVALID");
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM ${visualTables[kind]} WHERE id=?`,
    p.id,
  );
  if (row && row.store_id !== storeId) throw Error("VISUAL_SCOPE_INVALID");
  const local = row ? mapped(kind, row) : null;
  const serialized = JSON.stringify(p);
  if (local?.remote && local.remote.version > p.version) return;
  if (
    local?.remote &&
    local.remote.version === p.version &&
    JSON.stringify(local.remote) !== serialized
  )
    throw Error("VISUAL_HISTORY_CHANGED");
  if (
    local?.dirty &&
    (ackVersion === undefined ||
      local.entity.version !== ackVersion ||
      JSON.stringify(local.entity) !== serialized)
  ) {
    await db.runAsync(
      `UPDATE ${visualTables[kind]} SET remote_payload_json=?,remote_version=? WHERE id=?`,
      serialized,
      ackVersion ?? local.remoteVersion,
      p.id,
    );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > p.version) return;
  const collision =
    kind === "visual_asset" && "contentHash" in p
      ? await db.getFirstAsync<Row>(
          "SELECT * FROM visual_assets WHERE store_id=? AND content_hash=? AND id<>?",
          storeId,
          p.contentHash,
          p.id,
        )
      : kind === "product_visual_link" && "productId" in p && !p.deletedAt
        ? await db.getFirstAsync<Row>(
            "SELECT * FROM product_visual_links WHERE store_id=? AND product_id=? AND deleted_at IS NULL AND id<>?",
            storeId,
            p.productId,
            p.id,
          )
        : null;
  if (collision) {
    const pending = await db.getFirstAsync<{ command_id: string }>(
      "SELECT command_id FROM sync_outbox WHERE store_id=? AND entity_type=? AND entity_id=? AND status<>'ACKNOWLEDGED' ORDER BY local_sequence DESC LIMIT 1",
      storeId,
      kind,
      collision.id,
    );
    if (!collision.dirty || !pending) throw Error("VISUAL_CANONICAL_COLLISION");
    const command = await new OutboxRepository(db).getById(pending.command_id);
    if (!command) throw Error("VISUAL_PENDING_COMMAND_MISSING");
    const code =
      kind === "visual_asset"
        ? "VISUAL_BINARY_COLLISION"
        : "VISUAL_LINK_COLLISION";
    await new ConflictRepository(db).recordPushConflict(command, {
      commandId: command.commandId,
      entityType: kind,
      entityId: collision.id,
      status: "CONFLICT",
      remoteVersion: p.version,
      remoteEntity: p,
      error: {
        code,
        messageFr:
          "Un autre choix a été synchronisé. Votre version locale est conservée.",
        retryable: false,
        requestId: command.commandId,
      },
    });
    await db.runAsync(
      "UPDATE sync_conflicts SET remote_payload_json=?,remote_version=?,conflict_type=? WHERE id=? AND status='OPEN'",
      serialized,
      p.version,
      code,
      command.commandId,
    );
    await db.runAsync(
      "UPDATE sync_outbox SET status='CONFLICT',last_error_code=? WHERE store_id=? AND entity_type=? AND entity_id=? AND status<>'ACKNOWLEDGED'",
      code,
      storeId,
      kind,
      collision.id,
    );
    await db.runAsync(
      `UPDATE ${visualTables[kind]} SET sync_state='CONFLICT' WHERE id=? AND store_id=?`,
      collision.id,
      storeId,
    );
    return;
  }
  await writeVisual(db, kind, p, serialized, p.version, false);
}

export class VisualLibraryRepository {
  constructor(private db: OutboxDatabase & AtomicMutationDatabase) {}
  async get<K extends VisualEntityType>(kind: K, storeId: string, id: string) {
    const row = await this.db.getFirstAsync<Row>(
      `SELECT * FROM ${visualTables[kind]} WHERE id=? AND store_id=?`,
      id,
      storeId,
    );
    return row ? mapped(kind, row) : null;
  }
  async list<K extends VisualEntityType>(kind: K, storeId: string) {
    z.uuid().parse(storeId);
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM ${visualTables[kind]} WHERE store_id=? ORDER BY id`,
      storeId,
    );
    return rows.map((r) => mapped(kind, r));
  }
  async save<K extends VisualEntityType>(
    kind: K,
    raw: VisualEntityMap[K],
    ctx: {
      storeId: string;
      actorId: string;
      deviceId: string;
      commandId: string;
      canWrite: boolean;
      expectedLocalVersion: number | null;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const repo = new VisualLibraryRepository(joinedMutationDatabase(tx));
      const id = z.uuid().parse(raw.id);
      const row = await tx.getFirstAsync<Row>(
        `SELECT * FROM ${visualTables[kind]} WHERE id=?`,
        id,
      );
      if (row && row.store_id !== ctx.storeId)
        throw Error("VISUAL_SCOPE_INVALID");
      const before = row ? mapped(kind, row) : null;
      if (before?.dirty && before.entity.updatedBy !== ctx.actorId)
        throw Error("VISUAL_OWNER_PENDING");
      if (
        before &&
        (["CONFLICT", "ERROR"].includes(before.syncState) ||
          (before.remote &&
            before.remote.version > (before.remoteVersion ?? 0)))
      )
        throw Error("VISUAL_RESOLVE_REQUIRED");
      if ((before?.entity.version ?? null) !== ctx.expectedLocalVersion)
        throw Error("VISUAL_REVISION_INVALID");
      const p = validateVisualMutation(kind, before?.entity ?? null, raw, ctx);
      if (kind === "visual_identity") {
        const identity = p as VisualEntityMap["visual_identity"];
        if (identity.primaryAssetId && !identity.deletedAt) {
          const parent = await repo.get(
            "visual_asset",
            ctx.storeId,
            identity.primaryAssetId,
          );
          if (
            !parent ||
            parent.entity.deletedAt ||
            ["ERROR", "CONFLICT"].includes(parent.syncState)
          )
            throw Error("VISUAL_ASSET_UNAVAILABLE");
        }
      }
      if (kind === "product_visual_link" && !p.deletedAt) {
        const link = p as VisualEntityMap["product_visual_link"];
        const product = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM products WHERE id=? AND store_id=? AND deleted_at IS NULL AND status<>'INACTIVE' AND sync_state NOT IN ('ERROR','CONFLICT')",
          link.productId,
          ctx.storeId,
        );
        const identity = await repo.get(
          "visual_identity",
          ctx.storeId,
          link.visualIdentityId,
        );
        if (
          !product ||
          !identity ||
          identity.entity.deletedAt ||
          ["CONFLICT", "ERROR"].includes(identity.syncState)
        )
          throw Error("VISUAL_TARGET_UNAVAILABLE");
        const assetId = link.overrideAssetId ?? identity.entity.primaryAssetId;
        const asset = assetId
          ? await repo.get("visual_asset", ctx.storeId, assetId)
          : null;
        if (
          link.verification === "APPROVED" &&
          (!asset ||
            asset.entity.deletedAt ||
            asset.entity.review.status !== "APPROVED" ||
            ["CONFLICT", "ERROR"].includes(asset.syncState) ||
            asset.remote?.review.status === "REVOKED" ||
            asset.remote?.deletedAt)
        )
          throw Error("VISUAL_ASSET_UNAVAILABLE");
      }
      await writeVisual(
        tx,
        kind,
        p,
        before?.remote ? JSON.stringify(before.remote) : null,
        before?.remoteVersion ?? null,
        true,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        storeId: ctx.storeId,
        deviceId: ctx.deviceId,
        entityType: kind,
        entityId: p.id,
        commandType: `${kind.toUpperCase()}_UPSERT`,
        payload: p,
        expectedRemoteVersion: before?.dirty
          ? before.entity.version
          : (before?.remoteVersion ?? null),
      });
    });
  }
  async resolve(product: Product) {
    const [assets, identities, links] = await Promise.all([
      this.list("visual_asset", product.storeId),
      this.list("visual_identity", product.storeId),
      this.list("product_visual_link", product.storeId),
    ]);
    const safe = <T extends { deletedAt: string | null }>(
      row: LocalVisualRecord<T>,
    ) =>
      !row.remote?.deletedAt && !["CONFLICT", "ERROR"].includes(row.syncState);
    return resolveProductVisual({
      product,
      assets: assets
        .filter(
          (r) =>
            safe(r) &&
            !r.remote?.deletedAt &&
            !["REJECTED", "REVOKED"].includes(r.remote?.review.status ?? ""),
        )
        .map((r) => r.entity),
      identities: identities.filter(safe).map((r) => r.entity),
      links: links.filter(safe).map((r) => r.entity),
    });
  }
}
