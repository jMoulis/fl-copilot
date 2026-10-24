import {
  storeProductEventSchema,
  closeStoreEventPayloadSchema,
  prepareStoreProductEvent,
  closeStoreProductEvent,
  sameStoreEventCapture,
  storeEventCapturePayload,
  type StoreProductEvent,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  ConflictRepository,
  reviewConflictVersions,
} from "../sync/conflict-repository";
type Row = {
  id: string;
  store_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
  last_error_code?: string | null;
};
export type LocalStoreProductEvent = {
  entity: StoreProductEvent;
  remote: StoreProductEvent | null;
  remoteVersion: number | null;
  syncState: string;
  lastErrorCode: string | null;
};
function mapped(r: Row): LocalStoreProductEvent {
  return {
    entity: storeProductEventSchema.parse(JSON.parse(r.payload_json)),
    remote: r.remote_payload_json
      ? storeProductEventSchema.parse(JSON.parse(r.remote_payload_json))
      : null,
    remoteVersion: r.remote_version,
    syncState: r.sync_state,
    lastErrorCode: r.last_error_code ?? null,
  };
}
export async function applyStoreProductEvent(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const e = storeProductEventSchema.parse(payload);
  if (e.storeId !== storeId) throw Error("STORE_EVENT_STORE_INVALID");
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM store_product_events WHERE id=?",
    e.id,
  );
  if (old && old.store_id !== storeId) throw Error("STORE_EVENT_STORE_INVALID");
  const previous = old ? mapped(old) : null;
  if (previous && !sameStoreEventCapture(previous.entity, e))
    throw Error("STORE_EVENT_IDENTITY_CHANGED");
  if (
    old?.dirty &&
    (ackVersion === undefined || previous!.entity.version !== ackVersion)
  ) {
    if (!previous!.remote || e.version >= previous!.remote.version)
      await db.runAsync(
        "UPDATE store_product_events SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(e),
        ackVersion ?? null,
        e.version,
        e.id,
      );
    return;
  }
  if (previous && (previous.remoteVersion ?? 0) > e.version) return;
  await db.runAsync(
    "INSERT INTO store_product_events(id,store_id,product_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    e.id,
    storeId,
    e.productId,
    JSON.stringify(e),
    JSON.stringify(e),
    e.version,
  );
}
export async function readStoreEventConflictReview(
  db: OutboxDatabase,
  storeId: string,
  conflictId: string,
  digest: (s: string) => Promise<string>,
) {
  const requested = await new ConflictRepository(db).getById(conflictId);
  if (
    !requested ||
    requested.storeId !== storeId ||
    requested.entityType !== "store_product_event" ||
    requested.status !== "OPEN"
  )
    throw Error("STORE_EVENT_RESOLUTION_INVALID");
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM store_product_events WHERE id=? AND store_id=?",
    requested.entityId,
    storeId,
  );
  if (!row) throw Error("STORE_EVENT_RESOLUTION_INVALID");
  const current = mapped(row),
    local = current.entity;
  if (local.id !== requested.entityId || local.storeId !== storeId)
    throw Error("STORE_EVENT_STORE_INVALID");
  const conflicts = await new ConflictRepository(db).listOpenForEntity(
      storeId,
      "store_product_event",
      local.id,
    ),
    group = reviewConflictVersions(
      conflicts,
      (raw) => {
        const parsed = storeProductEventSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      },
      (remote) => remote.id === local.id && remote.storeId === storeId,
      current.remote,
    ),
    remote = group.remote,
    commands = await db.getAllAsync<{
      command_id: string;
      status: string;
      payload_json: string;
      expected_remote_version: number | null;
    }>(
      "SELECT command_id,status,payload_json,expected_remote_version FROM sync_outbox WHERE store_id=? AND entity_type='store_product_event' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') ORDER BY local_sequence LIMIT 101",
      storeId,
      local.id,
    );
  const productRows = await db.getAllAsync<{ id: string; label: string }>(
      "SELECT id,label FROM products WHERE store_id=? AND id IN (?,?) ORDER BY id",
      storeId,
      local.productId,
      remote?.productId ?? local.productId,
    ),
    products: Record<string, string> = Object.fromEntries(
      productRows.map((p) => [p.id, p.label]),
    );
  const sameRemoteCapture =
    !!remote &&
    conflicts.every((c) => {
      const parsed = storeProductEventSchema.safeParse(c.remotePayload);
      return parsed.success && sameStoreEventCapture(parsed.data, remote);
    }) &&
    (!current.remote || sameStoreEventCapture(current.remote, remote));
  const ready =
      group.valid &&
      !!remote &&
      sameRemoteCapture &&
      current.syncState === "CONFLICT" &&
      (current.remoteVersion ?? 0) <= remote.version &&
      commands.length <= 100 &&
      !commands.some((c) => c.status === "SYNCING"),
    canKeepLocal =
      ready &&
      local.source === "USER" &&
      remote!.source === "USER" &&
      local.status === "CLOSED" &&
      sameStoreEventCapture(local, remote!),
    canAdoptRemote = ready;
  const reason =
    group.reason ??
    (!sameRemoteCapture
      ? "La capture initiale des versions synchronisées diffère. Aucune observation n’est réaffectée automatiquement."
      : !ready
        ? "Le signalement a changé ou un envoi est en cours. Relisez la comparaison avant de décider."
        : !canKeepLocal
          ? "Seule la fin d’une observation magasin déjà clôturée et de capture identique peut être conservée. Vous pouvez adopter la version synchronisée sans la transformer en nouvelle observation."
          : null);
  const hash = await digest(
    JSON.stringify({ row, conflicts, commands, remote, products }),
  );
  return {
    current,
    group,
    hash,
    ready,
    canKeepLocal,
    canAdoptRemote,
    reason,
    products,
  };
}
export class StoreProductEventRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (s: string) => Promise<string> = async () => {
      throw Error("STORE_EVENT_DIGEST_REQUIRED");
    },
  ) {}
  review(storeId: string, conflictId: string) {
    return readStoreEventConflictReview(
      this.db,
      storeId,
      conflictId,
      this.digest,
    );
  }
  async list(storeId: string) {
    return (
      await this.db.getAllAsync<Row>(
        "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_type='store_product_event' AND o.entity_id=p.id ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM store_product_events p WHERE p.store_id=? ORDER BY json_extract(p.payload_json,'$.startedAt') DESC,p.id",
        storeId,
      )
    ).map(mapped);
  }
  async get(storeId: string, id: string) {
    const r = await this.db.getFirstAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_type='store_product_event' AND o.entity_id=p.id ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM store_product_events p WHERE p.store_id=? AND p.id=?",
      storeId,
      id,
    );
    return r ? mapped(r) : null;
  }
  async create(
    storeId: string,
    payload: unknown,
    ctx: { commandId: string; deviceId: string },
  ) {
    const e = prepareStoreProductEvent(storeId, payload);
    let saved = e;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const old = await tx.getFirstAsync<Row>(
        "SELECT * FROM store_product_events WHERE id=?",
        e.id,
      );
      if (old) {
        const previous = mapped(old);
        if (!sameStoreEventCapture(previous.entity, e))
          throw Error("STORE_EVENT_IDENTITY_CHANGED");
        saved = previous.entity;
        return;
      }
      const product = await tx.getFirstAsync<{
        store_id: string;
        deleted_at: string | null;
      }>("SELECT store_id,deleted_at FROM products WHERE id=?", e.productId);
      if (!product || product.store_id !== storeId || product.deleted_at)
        throw Error("STORE_EVENT_PRODUCT_INVALID");
      await tx.runAsync(
        "INSERT INTO store_product_events(id,store_id,product_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1)",
        e.id,
        storeId,
        e.productId,
        JSON.stringify(e),
      );
      await history(tx, e, ctx.commandId, "CREATE", e.createdAt);
      await enqueue(
        tx,
        e,
        ctx,
        "CREATE_STORE_EVENT",
        null,
        storeEventCapturePayload(e),
        e.createdAt,
      );
    });
    return saved;
  }
  async close(
    storeId: string,
    id: string,
    endedAt: string,
    ctx: { commandId: string; deviceId: string; capturedAt: string },
  ) {
    endedAt = closeStoreEventPayloadSchema.parse({ endedAt }).endedAt;
    let saved: StoreProductEvent | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM store_product_events WHERE id=? AND store_id=?",
        id,
        storeId,
      );
      if (!row) throw Error("STORE_EVENT_MISSING");
      const old = mapped(row);
      if (old.syncState === "CONFLICT")
        throw Error("STORE_EVENT_RESOLVE_REQUIRED");
      if (old.entity.source !== "USER")
        throw Error("STORE_EVENT_SOURCE_INVALID");
      if (old.entity.status === "CLOSED") {
        if (old.entity.endedAt !== endedAt)
          throw Error("STORE_EVENT_ALREADY_CLOSED");
        saved = old.entity;
        return;
      }
      if (old.syncState === "ERROR" && old.remoteVersion === null)
        throw Error("STORE_EVENT_CREATE_PENDING");
      const next = closeStoreProductEvent(old.entity, endedAt, ctx.capturedAt);
      saved = next;
      await tx.runAsync(
        "UPDATE store_product_events SET payload_json=?,sync_state='PENDING',dirty=1 WHERE id=?",
        JSON.stringify(next),
        id,
      );
      await history(tx, next, ctx.commandId, "CLOSE", ctx.capturedAt);
      await enqueue(
        tx,
        next,
        ctx,
        "CLOSE_STORE_EVENT",
        old.entity.version,
        { endedAt },
        ctx.capturedAt,
      );
    });
    return saved!;
  }
  async retry(
    storeId: string,
    id: string,
    ctx: {
      commandId: string;
      deviceId: string;
      capturedAt: string;
      closeCommandId?: string;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM store_product_events WHERE id=? AND store_id=?",
        id,
        storeId,
      );
      if (!row || row.sync_state !== "ERROR")
        throw Error("STORE_EVENT_RETRY_INVALID");
      const old = mapped(row),
        creation = row.remote_version === null;
      if (
        !creation &&
        (old.entity.status !== "CLOSED" ||
          old.entity.source !== "USER" ||
          (old.remote && !sameStoreEventCapture(old.entity, old.remote)))
      )
        throw Error("STORE_EVENT_RETRY_INVALID");
      let birth: StoreProductEvent | undefined;
      if (creation) {
        const first = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM store_product_event_history WHERE store_id=? AND event_id=? AND action='CREATE' ORDER BY created_at,action_id LIMIT 1",
          storeId,
          id,
        );
        if (!first) throw Error("STORE_EVENT_RETRY_INVALID");
        birth = storeProductEventSchema.parse(JSON.parse(first.payload_json));
        if (!sameStoreEventCapture(old.entity, birth))
          throw Error("STORE_EVENT_IMMUTABLE_CAPTURE");
      }
      const needsClose =
        creation &&
        birth!.status !== "CLOSED" &&
        old.entity.status === "CLOSED";
      if (
        needsClose &&
        (!ctx.closeCommandId || ctx.closeCommandId === ctx.commandId)
      )
        throw Error("STORE_EVENT_RETRY_INVALID");
      const e = creation
        ? needsClose
          ? closeStoreProductEvent(birth!, old.entity.endedAt!, ctx.capturedAt)
          : birth!
        : storeProductEventSchema.parse({
            ...old.entity,
            version: row.remote_version! + 1,
            updatedAt: ctx.capturedAt,
          });
      await retire(tx, storeId, id);
      await tx.runAsync(
        "UPDATE store_product_events SET payload_json=?,sync_state='PENDING',dirty=1 WHERE id=?",
        JSON.stringify(e),
        id,
      );
      await history(
        tx,
        creation ? birth! : e,
        ctx.commandId,
        creation ? "RETRY_CREATE" : "RETRY_CLOSE",
        ctx.capturedAt,
      );
      await enqueue(
        tx,
        e,
        ctx,
        creation ? "CREATE_STORE_EVENT" : "CLOSE_STORE_EVENT",
        creation ? null : row.remote_version,
        creation ? storeEventCapturePayload(birth!) : { endedAt: e.endedAt },
        ctx.capturedAt,
      );
      if (needsClose) {
        const second = { ...ctx, commandId: ctx.closeCommandId! };
        await history(tx, e, second.commandId, "RETRY_CLOSE", ctx.capturedAt);
        await enqueue(
          tx,
          e,
          second,
          "CLOSE_STORE_EVENT",
          1,
          { endedAt: e.endedAt },
          ctx.capturedAt,
        );
      }
    });
  }
  async resolve(
    conflictId: string,
    useLocal: boolean,
    ctx: {
      storeId: string;
      commandId: string;
      remoteHistoryId: string;
      deviceId: string;
      capturedAt: string;
      reviewHash: string;
      canResolve: () => boolean;
      signal?: AbortSignal;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("STORE_EVENT_FORBIDDEN");
      const review = await readStoreEventConflictReview(
          tx,
          ctx.storeId,
          conflictId,
          this.digest,
        ),
        local = review.current.entity,
        remote = review.group.remote;
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("STORE_EVENT_FORBIDDEN");
      if (
        !remote ||
        review.hash !== ctx.reviewHash ||
        !(useLocal ? review.canKeepLocal : review.canAdoptRemote)
      )
        throw Error("STORE_EVENT_SOURCE_CHANGED");
      const sameEnd =
          useLocal &&
          remote.status === "CLOSED" &&
          local.endedAt === remote.endedAt,
        next =
          useLocal && !sameEnd
            ? closeStoreProductEvent(remote, local.endedAt!, ctx.capturedAt)
            : remote;
      await retire(tx, local.storeId, local.id);
      await tx.runAsync(
        "UPDATE store_product_events SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=?,product_id=? WHERE id=? AND store_id=?",
        JSON.stringify(next),
        JSON.stringify(remote),
        remote.version,
        useLocal && !sameEnd ? "PENDING" : "SYNCED",
        useLocal && !sameEnd ? 1 : 0,
        next.productId,
        local.id,
        local.storeId,
      );
      await history(
        tx,
        local,
        ctx.commandId,
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        ctx.capturedAt,
      );
      if (
        !review.group.conflicts.some(
          (c) =>
            JSON.stringify(storeProductEventSchema.parse(c.remotePayload)) ===
            JSON.stringify(remote),
        )
      )
        await history(
          tx,
          remote,
          ctx.remoteHistoryId,
          "RESOLUTION_REMOTE_BASELINE",
          ctx.capturedAt,
        );
      for (const conflict of review.group.conflicts)
        await tx.runAsync(
          "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
          useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
          ctx.capturedAt,
          conflict.id,
          local.storeId,
        );
      if (useLocal && !sameEnd)
        await enqueue(
          tx,
          next,
          ctx,
          "CLOSE_STORE_EVENT",
          remote.version,
          { endedAt: next.endedAt },
          ctx.capturedAt,
        );
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("STORE_EVENT_FORBIDDEN");
    });
  }
}

async function history(
  tx: OutboxDatabase,
  e: StoreProductEvent,
  actionId: string,
  action: string,
  at: string,
) {
  await tx.runAsync(
    "INSERT INTO store_product_event_history(action_id,event_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
    actionId,
    e.id,
    e.storeId,
    JSON.stringify(e),
    action,
    at,
  );
}
async function enqueue(
  tx: OutboxDatabase,
  e: StoreProductEvent,
  ctx: { commandId: string; deviceId: string },
  type: string,
  expected: number | null,
  payload: unknown,
  at: string,
) {
  await new OutboxRepository(tx).enqueue({
    commandId: ctx.commandId,
    deviceId: ctx.deviceId,
    storeId: e.storeId,
    commandType: type,
    entityType: "store_product_event",
    entityId: e.id,
    expectedRemoteVersion: expected,
    payload,
    createdAt: at,
  });
}
async function retire(tx: OutboxDatabase, storeId: string, id: string) {
  const syncing = await tx.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) n FROM sync_outbox WHERE store_id=? AND entity_type='store_product_event' AND entity_id=? AND status='SYNCING'",
    storeId,
    id,
  );
  if (syncing?.n) throw Error("STORE_EVENT_SYNCING");
  await tx.runAsync(
    "UPDATE sync_outbox SET status='FAILED',last_error_code='STORE_EVENT_SUPERSEDED' WHERE store_id=? AND entity_type='store_product_event' AND entity_id=? AND status IN ('PENDING','FAILED','CONFLICT')",
    storeId,
    id,
  );
}
