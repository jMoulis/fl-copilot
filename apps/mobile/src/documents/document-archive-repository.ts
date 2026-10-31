import {
  documentArchiveSchema,
  type DocumentArchive,
  type DocumentArchiveKind,
} from "@fl-copilot/domain";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";

type Db = OutboxDatabase & AtomicMutationDatabase;
export type DocumentArchiveScope = { storeId: string; ownerId: string };
interface Row {
  id: string;
  store_id: string;
  owner_id: string;
  target_kind: string;
  archived: number;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  pending_command_id: string | null;
}
function scoped(scope: DocumentArchiveScope, raw: unknown) {
  const entity = documentArchiveSchema.parse(raw);
  if (entity.storeId !== scope.storeId || entity.ownerId !== scope.ownerId)
    throw Error("DOCUMENT_ARCHIVE_SCOPE_INVALID");
  return entity;
}
async function read(
  db: OutboxDatabase,
  scope: DocumentArchiveScope,
  id: string,
) {
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM document_archives WHERE store_id=? AND owner_id=? AND id=?",
    scope.storeId,
    scope.ownerId,
    id,
  );
  if (!row) return null;
  const entity = scoped(scope, JSON.parse(row.payload_json));
  if (
    entity.id !== row.id ||
    entity.targetKind !== row.target_kind ||
    Number(entity.archived) !== row.archived
  )
    throw Error("DOCUMENT_ARCHIVE_RECORD_INVALID");
  if (row.remote_payload_json) {
    const remote = scoped(scope, JSON.parse(row.remote_payload_json));
    if (
      remote.id !== id ||
      remote.targetKind !== entity.targetKind ||
      remote.version !== row.remote_version
    )
      throw Error("DOCUMENT_ARCHIVE_RECORD_INVALID");
  } else if (row.remote_version !== null)
    throw Error("DOCUMENT_ARCHIVE_RECORD_INVALID");
  return { row, entity };
}
async function write(
  db: OutboxDatabase,
  entity: DocumentArchive,
  remote: DocumentArchive | null,
  pending: string | null,
) {
  await db.runAsync(
    "INSERT INTO document_archives(id,store_id,owner_id,target_kind,archived,payload_json,remote_payload_json,remote_version,pending_command_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(store_id,owner_id,id) DO UPDATE SET target_kind=excluded.target_kind,archived=excluded.archived,payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,pending_command_id=excluded.pending_command_id",
    entity.id,
    entity.storeId,
    entity.ownerId,
    entity.targetKind,
    Number(entity.archived),
    JSON.stringify(entity),
    remote ? JSON.stringify(remote) : null,
    remote?.version ?? null,
    pending,
  );
}

/** List metadata is deliberately separate from immutable sources and publication. */
export class DocumentArchiveRepository {
  constructor(
    private db: Db,
    readonly scope: DocumentArchiveScope,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async list() {
    const rows = await this.db.getAllAsync<Row>(
      "SELECT * FROM document_archives WHERE store_id=? AND owner_id=?",
      this.scope.storeId,
      this.scope.ownerId,
    );
    return rows.map((row) => {
      const entity = scoped(this.scope, JSON.parse(row.payload_json));
      if (
        entity.id !== row.id ||
        entity.targetKind !== row.target_kind ||
        Number(entity.archived) !== row.archived
      )
        throw Error("DOCUMENT_ARCHIVE_RECORD_INVALID");
      return entity;
    });
  }
  async set(
    id: string,
    targetKind: DocumentArchiveKind,
    archived: boolean,
    context: { commandId: string; deviceId: string; canWrite(): boolean },
  ) {
    if (!context.canWrite()) throw Error("DOCUMENT_ARCHIVE_SCOPE_CHANGED");
    let changed = false;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!context.canWrite()) throw Error("DOCUMENT_ARCHIVE_SCOPE_CHANGED");
      const { storeId, ownerId } = this.scope;
      const target =
        targetKind === "COMMERCIAL_DOCUMENT"
          ? await tx.getFirstAsync(
              "SELECT id FROM source_documents WHERE id=? AND store_id=? AND source_type='WEEKLY_COMMERCIAL_PDF' AND deleted_at IS NULL UNION ALL SELECT id FROM commercial_review_pages WHERE source_document_id=? AND store_id=? LIMIT 1",
              id,
              storeId,
              id,
              storeId,
            )
          : targetKind === "MERCALYS_BATCH"
            ? await tx.getFirstAsync(
                "SELECT id FROM mercalys_intake_batches WHERE id=? AND store_id=? AND owner_id=? UNION ALL SELECT id FROM mercalys_intake_archives WHERE json_extract(request_json,'$.batchId')=? AND store_id=? AND owner_id=? LIMIT 1",
                id,
                storeId,
                ownerId,
                id,
                storeId,
                ownerId,
              )
            : await tx.getFirstAsync(
                "SELECT i.id FROM mercalys_intake_items i JOIN mercalys_intake_batches b ON b.id=i.batch_id WHERE i.id=? AND b.store_id=? AND b.owner_id=?",
                id,
                storeId,
                ownerId,
              );
      if (!target) throw Error("DOCUMENT_ARCHIVE_TARGET_UNAVAILABLE");
      const old = await read(tx, this.scope, id);
      if (old && old.entity.targetKind !== targetKind)
        throw Error("DOCUMENT_ARCHIVE_SCOPE_INVALID");
      if ((old?.entity.archived ?? false) === archived) return;
      const entity = documentArchiveSchema.parse({
        id,
        storeId,
        ownerId,
        targetKind,
        archived,
        version:
          Math.max(old?.entity.version ?? 0, old?.row.remote_version ?? 0) + 1,
        updatedAt: this.now(),
      });
      const remote = old?.row.remote_payload_json
        ? scoped(this.scope, JSON.parse(old.row.remote_payload_json))
        : null;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='DOCUMENT_ARCHIVE_SUPERSEDED' WHERE store_id=? AND entity_type='document_archive' AND entity_id=? AND status IN ('PENDING','FAILED') AND json_extract(payload_json,'$.ownerId')=?",
        storeId,
        id,
        ownerId,
      );
      await write(tx, entity, remote, context.commandId);
      await new OutboxRepository(tx, this.now).enqueue({
        commandId: context.commandId,
        deviceId: context.deviceId,
        storeId,
        entityType: "document_archive",
        entityId: id,
        commandType: "DOCUMENT_ARCHIVE_SET",
        expectedRemoteVersion: remote?.version ?? null,
        payload: entity,
        createdAt: entity.updatedAt,
      });
      if (!context.canWrite()) throw Error("DOCUMENT_ARCHIVE_SCOPE_CHANGED");
      changed = true;
    });
    return changed;
  }
}

/** A late acknowledgement must never replace a newer local archive/restore intent. */
export async function applyDocumentArchive(
  db: OutboxDatabase,
  scope: DocumentArchiveScope,
  raw: unknown,
  acknowledgedCommandId?: string,
) {
  const incoming = scoped(scope, raw),
    old = await read(db, scope, incoming.id);
  if (old && old.entity.targetKind !== incoming.targetKind)
    throw Error("DOCUMENT_ARCHIVE_SCOPE_INVALID");
  const previous = old?.row.remote_payload_json
    ? scoped(scope, JSON.parse(old.row.remote_payload_json))
    : null;
  if (
    previous?.version === incoming.version &&
    JSON.stringify(previous) !== JSON.stringify(incoming)
  )
    throw Error("DOCUMENT_ARCHIVE_VERSION_INVALID");
  const remote =
    previous && previous.version > incoming.version ? previous : incoming;
  const pending = old?.row.pending_command_id ?? null;
  const keepLocal = pending !== null && pending !== acknowledgedCommandId;
  await write(
    db,
    keepLocal ? old!.entity : remote,
    remote,
    keepLocal ? pending : null,
  );
}
