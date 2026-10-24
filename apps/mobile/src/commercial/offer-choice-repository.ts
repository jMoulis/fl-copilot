import {
  commercialOfferChoiceSchema,
  type CommercialOfferChoice,
} from "@fl-copilot/sync-contracts";
import {
  commercialChoiceId,
  commercialChoiceDuplicateKey,
  commercialChoiceSameSource,
} from "@fl-copilot/commercial-core";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  readCommercialConflictReview,
  requireCommercialConflictDecision,
  type CommercialConflictResolutionContext,
} from "./conflict-review";
import { readCommercialVisualReadings } from "./visual-repository";
import {
  mapCommercialChoice as mapped,
  readCommercialChoices,
  type CommercialChoiceRow as Row,
} from "./choice-read";
export { readCommercialChoices };
export type { LocalCommercialChoice } from "./choice-read";
export async function applyCommercialChoice(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const choice = commercialOfferChoiceSchema.parse(payload);
  if (choice.storeId !== storeId)
    throw Error("COMMERCIAL_CHOICE_STORE_INVALID");
  const previous = await db.getFirstAsync<Row>(
    "SELECT * FROM commercial_offer_choices WHERE id=?",
    choice.id,
  );
  if (previous && previous.store_id !== storeId)
    throw Error("COMMERCIAL_CHOICE_STORE_INVALID");
  const local = previous ? mapped(previous) : null;
  if (
    local &&
    !commercialChoiceSameSource(
      { ...local.entity, createdAt: choice.createdAt },
      choice,
    )
  )
    throw Error("COMMERCIAL_CHOICE_SOURCE_CHANGED");
  if (
    previous?.dirty &&
    (ackVersion === undefined || local!.entity.version !== ackVersion)
  ) {
    const old = local!.remote;
    if (!old || choice.version >= old.version)
      await db.runAsync(
        "UPDATE commercial_offer_choices SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(choice),
        ackVersion ?? null,
        choice.version,
        choice.id,
      );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > choice.version) return;
  await db.runAsync(
    `INSERT INTO commercial_offer_choices(id,store_id,source_document_id,reading_id,operation_index,item_index,payload_json,remote_payload_json,remote_version,sync_state,dirty)
    VALUES(?,?,?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    choice.id,
    storeId,
    choice.source.sourceDocumentId,
    choice.source.readingId,
    choice.source.operationIndex,
    choice.source.itemIndex,
    JSON.stringify(choice),
    JSON.stringify(choice),
    choice.version,
  );
}
export class CommercialChoiceRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (text: string) => Promise<string>,
  ) {}
  review(storeId: string, conflictId: string) {
    return readCommercialConflictReview(
      this.db,
      storeId,
      "COMMERCIAL_CHOICE",
      conflictId,
      this.digest,
    );
  }
  async list(storeId: string, sourceDocumentId?: string) {
    return readCommercialChoices(this.db, storeId, sourceDocumentId);
  }

  async get(storeId: string, id: string) {
    const row = await this.db.getFirstAsync<Row>(
      `SELECT c.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=c.store_id AND o.entity_id=c.id AND o.entity_type='commercial_offer_choice' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_offer_choices c WHERE c.store_id=? AND c.id=?`,
      storeId,
      id,
    );
    return row ? mapped(row) : null;
  }
  async save(
    input: CommercialOfferChoice,
    ctx: { commandId: string; deviceId: string },
  ) {
    const choice = commercialOfferChoiceSchema.parse(input);
    const id = await commercialChoiceId(
      choice.storeId,
      choice.source,
      this.digest,
    );
    if (choice.id !== id) throw Error("COMMERCIAL_CHOICE_IDENTITY_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM commercial_offer_choices WHERE id=? AND store_id=?",
        choice.id,
        choice.storeId,
      );
      if (row?.sync_state === "CONFLICT")
        throw Error("COMMERCIAL_CHOICE_RESOLVE_REQUIRED");
      const previous = row ? mapped(row) : null;
      const expected =
        row?.sync_state === "ERROR"
          ? row.remote_version
          : (previous?.entity.version ?? null);
      if (
        choice.version !== (expected ?? 0) + 1 ||
        (previous && !commercialChoiceSameSource(previous.entity, choice))
      )
        throw Error("COMMERCIAL_CHOICE_REVISION_INVALID");
      const readings = await readCommercialVisualReadings(
        tx,
        choice.storeId,
        choice.source.sourceDocumentId,
      );
      const reading = readings.find(
        (r) =>
          r.id === choice.source.readingId &&
          r.checksum === choice.source.checksum,
      );
      const operation =
          reading?.reading?.operations[choice.source.operationIndex],
        item = operation?.items[choice.source.itemIndex];
      if (
        item?.kind !== "OFFER" ||
        operation?.kind !== choice.operationKind ||
        operation.label !== choice.operationLabel ||
        item.label !== choice.rawProductLabel
      )
        throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
      if (choice.status === "RETAINED") {
        const product = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM products WHERE id=? AND store_id=? AND status='ACTIVE' AND deleted_at IS NULL",
          choice.productId,
          choice.storeId,
        );
        if (!product) throw Error("COMMERCIAL_CHOICE_PRODUCT_INVALID");
        const other = await tx.getAllAsync<Row>(
          "SELECT * FROM commercial_offer_choices WHERE store_id=? AND source_document_id=? AND id!=?",
          choice.storeId,
          choice.source.sourceDocumentId,
          choice.id,
        );
        if (
          other.some((r) => {
            const c = mapped(r).entity;
            return (
              c.status === "RETAINED" &&
              commercialChoiceDuplicateKey(c) ===
                commercialChoiceDuplicateKey(choice)
            );
          })
        )
          throw Error("COMMERCIAL_CHOICE_DUPLICATE");
      }
      if (row?.sync_state === "ERROR") {
        const syncing = await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='commercial_offer_choice' AND entity_id=? AND status='SYNCING'",
          choice.storeId,
          choice.id,
        );
        if (syncing?.n) throw Error("COMMERCIAL_CHOICE_SYNCING");
      }
      if (row?.sync_state === "ERROR")
        await retireCommands(tx, choice.storeId, choice.id);
      await tx.runAsync(
        `INSERT INTO commercial_offer_choices(id,store_id,source_document_id,reading_id,operation_index,item_index,payload_json,sync_state,dirty)
        VALUES(?,?,?,?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1`,
        choice.id,
        choice.storeId,
        choice.source.sourceDocumentId,
        choice.source.readingId,
        choice.source.operationIndex,
        choice.source.itemIndex,
        JSON.stringify(choice),
      );
      await tx.runAsync(
        "INSERT INTO commercial_choice_history(action_id,choice_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        choice.id,
        choice.storeId,
        JSON.stringify(choice),
        choice.status,
        choice.updatedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: choice.storeId,
        commandType: "COMMERCIAL_OFFER_CHOICE_UPSERT",
        entityType: "commercial_offer_choice",
        entityId: choice.id,
        expectedRemoteVersion: expected,
        payload: choice,
        createdAt: choice.updatedAt,
      });
    });
    return choice;
  }
  async resolve(
    conflictId: string,
    useLocal: boolean,
    ctx: CommercialConflictResolutionContext,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("COMMERCIAL_CONFLICT_FORBIDDEN");
      const review = await readCommercialConflictReview(
        tx,
        ctx.storeId,
        "COMMERCIAL_CHOICE",
        conflictId,
        this.digest,
      );
      requireCommercialConflictDecision(review, useLocal, ctx);
      const local = commercialOfferChoiceSchema.parse(review.current.entity),
        remote = commercialOfferChoiceSchema.parse(review.group.remote);
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      const resolved = useLocal
        ? commercialOfferChoiceSchema.parse({
            ...local,
            createdAt: remote.createdAt,
            version: remote.version + 1,
            updatedAt: now,
          })
        : remote;
      await tx.runAsync(
        "UPDATE commercial_offer_choices SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
      );
      await tx.runAsync(
        "INSERT INTO commercial_choice_history(action_id,choice_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        local.id,
        local.storeId,
        JSON.stringify(local),
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        now,
      );
      if (
        !review.group.conflicts.some(
          (c) =>
            JSON.stringify(
              commercialOfferChoiceSchema.parse(c.remotePayload),
            ) === JSON.stringify(remote),
        )
      )
        await tx.runAsync(
          "INSERT INTO commercial_choice_history(action_id,choice_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
          ctx.remoteHistoryId,
          local.id,
          local.storeId,
          JSON.stringify(remote),
          "RESOLUTION_REMOTE_BASELINE",
          now,
        );
      for (const conflict of review.group.conflicts)
        await tx.runAsync(
          "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
          useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
          now,
          conflict.id,
          local.storeId,
        );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "COMMERCIAL_OFFER_CHOICE_UPSERT",
          entityType: "commercial_offer_choice",
          entityId: local.id,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("COMMERCIAL_CONFLICT_FORBIDDEN");
    });
  }
}
async function retireCommands(tx: OutboxDatabase, storeId: string, id: string) {
  await tx.runAsync(
    "UPDATE sync_outbox SET status='FAILED',last_error_code='COMMERCIAL_CHOICE_SUPERSEDED' WHERE store_id=? AND entity_type='commercial_offer_choice' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
    storeId,
    id,
  );
}
