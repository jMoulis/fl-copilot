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
import { ConflictRepository } from "../sync/conflict-repository";
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
export class StoreProductEventRepository {
  constructor(private db: AtomicMutationDatabase & OutboxDatabase) {}
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
    ctx: { commandId: string; deviceId: string; capturedAt: string },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const c = await new ConflictRepository(tx).getById(conflictId);
      if (!c || c.entityType !== "store_product_event" || c.status !== "OPEN")
        throw Error("STORE_EVENT_RESOLUTION_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM store_product_events WHERE id=? AND store_id=?",
        c.entityId,
        c.storeId,
      );
      if (!row) throw Error("STORE_EVENT_RESOLUTION_INVALID");
      const local = mapped(row).entity,
        parsed = storeProductEventSchema.safeParse(c.remotePayload),
        remote = parsed.success ? parsed.data : null;
      if (
        remote &&
        (remote.id !== local.id || remote.storeId !== local.storeId)
      )
        throw Error("STORE_EVENT_STORE_INVALID");
      if (
        useLocal &&
        (!remote ||
          !sameStoreEventCapture(local, remote) ||
          local.status !== "CLOSED")
      )
        throw Error("STORE_EVENT_IMMUTABLE_CAPTURE");
      if (!useLocal && !remote) throw Error("STORE_EVENT_REMOTE_MISSING");
      const pending = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM sync_outbox WHERE store_id=? AND entity_type='store_product_event' AND entity_id=? AND status='SYNCING'",
        c.storeId,
        c.entityId,
      );
      if (pending?.n) throw Error("STORE_EVENT_SYNCING");
      const sameEnd =
          useLocal &&
          remote?.status === "CLOSED" &&
          local.endedAt === remote.endedAt,
        next =
          useLocal && !sameEnd
            ? closeStoreProductEvent(remote!, local.endedAt!, ctx.capturedAt)
            : remote!;
      await retire(tx, c.storeId, c.entityId);
      await tx.runAsync(
        "UPDATE store_product_events SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=?,product_id=? WHERE id=?",
        JSON.stringify(next),
        JSON.stringify(remote),
        remote!.version,
        useLocal && !sameEnd ? "PENDING" : "SYNCED",
        useLocal && !sameEnd ? 1 : 0,
        next.productId,
        c.entityId,
      );
      await history(
        tx,
        local,
        ctx.commandId,
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        ctx.capturedAt,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='store_product_event' AND entity_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        ctx.capturedAt,
        c.storeId,
        c.entityId,
      );
      if (useLocal && !sameEnd)
        await enqueue(
          tx,
          next,
          ctx,
          "CLOSE_STORE_EVENT",
          remote!.version,
          { endedAt: next.endedAt },
          ctx.capturedAt,
        );
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
