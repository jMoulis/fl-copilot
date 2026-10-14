import {
  copilotConversationSchema,
  mercalysArchiveInputSchema,
  mercalysBatchInputSchema,
  mercalysBatchItemSchema,
  mercalysBatchResultSchema,
  type MercalysBatchInput,
  type MercalysBatchResult,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
type Db = OutboxDatabase & AtomicMutationDatabase;
type Scope = { storeId: string; ownerId: string };
/** Device-local working intake; canonical publication and its Outbox remain separate. */
export class MercalysBatchRepository {
  constructor(
    private db: Db,
    private scope: Scope,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  get ownerId() {
    return this.scope.ownerId;
  }
  get storeId() {
    return this.scope.storeId;
  }
  private async owned(tx: OutboxDatabase, batchId: string) {
    const row = await tx.getFirstAsync<{ request_json: string }>(
      "SELECT request_json FROM mercalys_intake_batches WHERE id=? AND store_id=? AND owner_id=?",
      batchId,
      this.scope.storeId,
      this.scope.ownerId,
    );
    if (!row) throw Error("MERCALYS_BATCH_UNAVAILABLE");
    const batch = mercalysBatchInputSchema.parse(JSON.parse(row.request_json));
    if (
      batch.id !== batchId ||
      batch.storeId !== this.scope.storeId ||
      batch.ownerId !== this.scope.ownerId
    )
      throw Error("MERCALYS_BATCH_SCOPE_INVALID");
    return batch;
  }
  async create(raw: MercalysBatchInput) {
    const batch = mercalysBatchInputSchema.parse(raw);
    if (
      batch.storeId !== this.scope.storeId ||
      batch.ownerId !== this.scope.ownerId
    )
      throw Error("MERCALYS_BATCH_SCOPE_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const existing = await tx.getFirstAsync<{ request_json: string }>(
        "SELECT request_json FROM mercalys_intake_batches WHERE id=?",
        batch.id,
      );
      if (existing) {
        const owned = await this.owned(tx, batch.id);
        if (JSON.stringify(owned) !== JSON.stringify(batch))
          throw Error("MERCALYS_BATCH_ID_REUSED");
        return;
      }
      await this.archive(tx, batch);
      if (batch.conversationId) {
        const row = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
          batch.conversationId,
          batch.storeId,
          batch.ownerId,
        );
        const c = row
          ? copilotConversationSchema.parse(JSON.parse(row.payload_json))
          : null;
        if (
          !c ||
          c.id !== batch.conversationId ||
          c.storeId !== batch.storeId ||
          c.ownerId !== batch.ownerId ||
          c.status !== "ACTIVE"
        )
          throw Error("MERCALYS_BATCH_CONVERSATION_INVALID");
      }
      await tx.runAsync(
        "INSERT INTO mercalys_intake_batches(id,store_id,owner_id,conversation_id,request_json,created_at,archive_id) VALUES(?,?,?,?,?,?,?)",
        batch.id,
        batch.storeId,
        batch.ownerId,
        batch.conversationId,
        JSON.stringify(batch),
        batch.createdAt,
        batch.archiveId ?? null,
      );
      for (let position = 0; position < batch.files.length; position++) {
        const item = mercalysBatchItemSchema.parse({
          ...batch.files[position],
          batchId: batch.id,
          position,
          version: 1,
          updatedAt: batch.createdAt,
          result: { status: "QUEUED" },
        });
        await tx.runAsync(
          "INSERT INTO mercalys_intake_items(id,batch_id,position,payload_json) VALUES(?,?,?,?)",
          item.id,
          batch.id,
          position,
          JSON.stringify(item),
        );
      }
    });
    return batch.id;
  }
  private async archive(tx: OutboxDatabase, batch: MercalysBatchInput) {
    if (!batch.archiveId) return;
    const row = await tx.getFirstAsync<{ request_json: string }>(
      "SELECT request_json FROM mercalys_intake_archives WHERE id=? AND store_id=? AND owner_id=?",
      batch.archiveId,
      this.scope.storeId,
      this.scope.ownerId,
    );
    const a = row
      ? mercalysArchiveInputSchema.parse(JSON.parse(row.request_json))
      : null;
    if (
      !a ||
      a.id !== batch.archiveId ||
      a.batchId !== batch.id ||
      a.storeId !== batch.storeId ||
      a.ownerId !== batch.ownerId ||
      a.createdAt !== batch.createdAt
    )
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
  }
  async appendArchive(raw: MercalysBatchInput) {
    const input = mercalysBatchInputSchema.parse(raw);
    if (
      !input.archiveId ||
      input.storeId !== this.scope.storeId ||
      input.ownerId !== this.scope.ownerId ||
      input.conversationId
    )
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await this.archive(tx, input);
      const existing = await tx.getFirstAsync<{ id: string }>(
        "SELECT id FROM mercalys_intake_batches WHERE id=?",
        input.id,
      );
      const current = existing
        ? await this.owned(tx, input.id)
        : { ...input, files: [] };
      if (
        current.archiveId !== input.archiveId ||
        current.createdAt !== input.createdAt ||
        current.conversationId
      )
        throw Error("MERCALYS_BATCH_ID_REUSED");
      if (!existing)
        await tx.runAsync(
          "INSERT INTO mercalys_intake_batches(id,store_id,owner_id,conversation_id,request_json,created_at,archive_id) VALUES(?,?,?,?,?,?,?)",
          input.id,
          input.storeId,
          input.ownerId,
          null,
          JSON.stringify(input),
          input.createdAt,
          input.archiveId!,
        );
      const files = [...current.files];
      for (const file of input.files) {
        const previous = files.find((f) => f.id === file.id);
        if (previous) {
          if (JSON.stringify(previous) !== JSON.stringify(file))
            throw Error("MERCALYS_BATCH_ID_REUSED");
          continue;
        }
        const position = files.length;
        files.push(file);
        const item = mercalysBatchItemSchema.parse({
          ...file,
          batchId: input.id,
          position,
          version: 1,
          updatedAt: input.createdAt,
          result: { status: "QUEUED" },
        });
        await tx.runAsync(
          "INSERT INTO mercalys_intake_items(id,batch_id,position,payload_json) VALUES(?,?,?,?)",
          file.id,
          input.id,
          position,
          JSON.stringify(item),
        );
      }
      const batch = mercalysBatchInputSchema.parse({ ...current, files });
      await tx.runAsync(
        "UPDATE mercalys_intake_batches SET request_json=? WHERE id=?",
        JSON.stringify(batch),
        batch.id,
      );
    });
    return input.id;
  }
  async recent(after?: { createdAt: string; id: string }) {
    const rows = await this.db.getAllAsync<{ request_json: string }>(
      "SELECT request_json FROM mercalys_intake_batches WHERE store_id=? AND owner_id=? AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 11",
      this.scope.storeId,
      this.scope.ownerId,
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.id ?? null,
    );
    const batches = rows
      .slice(0, 10)
      .map((row) =>
        mercalysBatchInputSchema.parse(JSON.parse(row.request_json)),
      );
    if (
      batches.some(
        (b) =>
          b.storeId !== this.scope.storeId || b.ownerId !== this.scope.ownerId,
      )
    )
      throw Error("MERCALYS_BATCH_SCOPE_INVALID");
    return { batches, hasMore: rows.length > 10 };
  }
  async refresh(batchId: string, itemId: string, expectedVersion: number) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const current = await this.readItem(tx, batchId, itemId);
      if (current.version !== expectedVersion)
        throw Error("MERCALYS_BATCH_ITEM_CHANGED");
      const next = mercalysBatchItemSchema.parse({
        ...current,
        result: { status: "QUEUED" },
        version: current.version + 1,
        updatedAt: this.now(),
      });
      await tx.runAsync(
        "UPDATE mercalys_intake_items SET payload_json=? WHERE id=? AND batch_id=?",
        JSON.stringify(next),
        itemId,
        batchId,
      );
    });
  }
  async page(batchId: string, after = -1, limit = 20) {
    await this.owned(this.db, batchId);
    if (
      !Number.isInteger(after) ||
      after < -1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw Error("MERCALYS_BATCH_PAGE_INVALID");
    const rows = await this.db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM mercalys_intake_items WHERE batch_id=? AND position>? ORDER BY position LIMIT ?",
      batchId,
      after,
      limit + 1,
    );
    const items = rows
      .slice(0, limit)
      .map((row) =>
        mercalysBatchItemSchema.parse(JSON.parse(row.payload_json)),
      );
    if (
      items.some((item) => item.batchId !== batchId || item.position <= after)
    )
      throw Error("MERCALYS_BATCH_SCOPE_INVALID");
    return {
      items,
      hasMore: rows.length > limit,
      after: items.at(-1)?.position ?? after,
    };
  }
  async get(batchId: string, itemId: string) {
    return this.readItem(this.db, batchId, itemId);
  }
  private async readItem(tx: OutboxDatabase, batchId: string, itemId: string) {
    const batch = await this.owned(tx, batchId);
    const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM mercalys_intake_items WHERE id=? AND batch_id=?",
      itemId,
      batchId,
    );
    if (!row) throw Error("MERCALYS_BATCH_ITEM_UNAVAILABLE");
    const item = mercalysBatchItemSchema.parse(JSON.parse(row.payload_json));
    const file = batch.files[item.position];
    if (
      item.id !== itemId ||
      item.batchId !== batchId ||
      !file ||
      file.id !== item.id ||
      file.checksum !== item.checksum ||
      file.localUri !== item.localUri ||
      file.filename !== item.filename ||
      file.sizeBytes !== item.sizeBytes
    )
      throw Error("MERCALYS_BATCH_SCOPE_INVALID");
    return item;
  }
  async finish(
    batchId: string,
    itemId: string,
    expectedVersion: number,
    raw: MercalysBatchResult,
  ) {
    const result = mercalysBatchResultSchema.parse(raw);
    let saved: Awaited<ReturnType<MercalysBatchRepository["get"]>> | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const current = await this.readItem(tx, batchId, itemId);
      if (
        current.version !== expectedVersion ||
        !["QUEUED", "FAILED"].includes(current.result.status)
      )
        throw Error("MERCALYS_BATCH_ITEM_CHANGED");
      saved = mercalysBatchItemSchema.parse({
        ...current,
        result,
        version: current.version + 1,
        updatedAt: this.now(),
      });
      await tx.runAsync(
        "UPDATE mercalys_intake_items SET payload_json=? WHERE id=? AND batch_id=?",
        JSON.stringify(saved),
        itemId,
        batchId,
      );
    });
    return saved!;
  }
}
