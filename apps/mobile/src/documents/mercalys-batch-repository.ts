import { mergeBusinessPeriods } from "@fl-copilot/domain";
import { assertIntakeConversation } from "./intake-conversation";
import {
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
type Scope = { storeId: string; ownerId: string; conversationId?: string };
/** Device-local working intake; canonical publication and its Outbox remain separate. */
export class MercalysBatchRepository {
  constructor(
    private db: Db,
    private scope: Scope,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  assertConversation(conversationId?: string | null) {
    if (
      this.scope.conversationId &&
      conversationId !== this.scope.conversationId
    )
      throw Error("MERCALYS_BATCH_SCOPE_INVALID");
    return assertIntakeConversation(this.db, this.scope, conversationId);
  }
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
      batch.ownerId !== this.scope.ownerId ||
      (this.scope.conversationId !== undefined &&
        batch.conversationId !== this.scope.conversationId)
    )
      throw Error("MERCALYS_BATCH_SCOPE_INVALID");
    return batch;
  }
  header(batchId: string) {
    return this.owned(this.db, batchId);
  }
  async create(raw: MercalysBatchInput) {
    const batch = mercalysBatchInputSchema.parse(raw);
    if (
      batch.storeId !== this.scope.storeId ||
      batch.ownerId !== this.scope.ownerId ||
      (this.scope.conversationId !== undefined &&
        batch.conversationId !== this.scope.conversationId)
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
      await assertIntakeConversation(tx, this.scope, batch.conversationId);
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
      a.createdAt !== batch.createdAt ||
      (a.conversationId ?? null) !== batch.conversationId
    )
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
  }
  async appendArchive(raw: MercalysBatchInput) {
    const input = mercalysBatchInputSchema.parse(raw);
    if (
      !input.archiveId ||
      input.storeId !== this.scope.storeId ||
      input.ownerId !== this.scope.ownerId ||
      (this.scope.conversationId !== undefined &&
        input.conversationId !== this.scope.conversationId)
    )
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await this.archive(tx, input);
      await assertIntakeConversation(tx, this.scope, input.conversationId);
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
        current.conversationId !== input.conversationId
      )
        throw Error("MERCALYS_BATCH_ID_REUSED");
      if (!existing)
        await tx.runAsync(
          "INSERT INTO mercalys_intake_batches(id,store_id,owner_id,conversation_id,request_json,created_at,archive_id) VALUES(?,?,?,?,?,?,?)",
          input.id,
          input.storeId,
          input.ownerId,
          input.conversationId,
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
  /** Derived from committed publication, never from the preparation snapshot. */
  async publications(batchId: string) {
    const batch = await this.owned(this.db, batchId);
    const checksums = [...new Set(batch.files.map((file) => file.checksum))];
    const rows = await this.db.getAllAsync<{
      checksum: string;
      source_type: string;
      published_count: number;
      remaining_count: number;
    }>(
      `SELECT d.checksum, d.source_type,
        (SELECT COUNT(*) FROM source_records r WHERE r.source_document_id=d.id AND r.store_id=d.store_id AND r.deleted_at IS NULL AND r.status='PUBLISHED') AS published_count,
        (SELECT COUNT(*) FROM source_records r WHERE r.source_document_id=d.id AND r.store_id=d.store_id AND r.deleted_at IS NULL AND r.status!='PUBLISHED') AS remaining_count
       FROM source_documents d WHERE d.store_id=? AND d.deleted_at IS NULL
        AND d.local_processing_status='PUBLISHED'
        AND d.source_type IN ('MERCALYS_SALES','MERCALYS_WASTE')
        AND d.checksum IN (${checksums.map(() => "?").join(",")})`,
      this.scope.storeId,
      ...checksums,
    );
    return rows;
  }
  async discussionQuestion(batchId: string) {
    const batch = await this.owned(this.db, batchId);
    if (!batch.conversationId)
      throw Error("MERCALYS_BATCH_CONVERSATION_INVALID");
    await assertIntakeConversation(this.db, this.scope, batch.conversationId);
    const checksums = [...new Set(batch.files.map((file) => file.checksum))];
    const periods = await this.db.getAllAsync<{
      source_type: string;
      start: string;
      end: string;
    }>(
      `SELECT source_type, business_period_start AS start, business_period_end AS end
       FROM source_documents WHERE store_id=? AND deleted_at IS NULL AND local_processing_status='PUBLISHED'
       AND source_type IN ('MERCALYS_SALES','MERCALYS_WASTE')
       AND checksum IN (${checksums.map(() => "?").join(",")}) ORDER BY source_type,business_period_start,business_period_end`,
      this.scope.storeId,
      ...checksums,
    );
    if (
      !periods.length ||
      periods.some(
        (p) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(p.start ?? "") ||
          !/^\d{4}-\d{2}-\d{2}$/.test(p.end ?? ""),
      )
    )
      throw Error("MERCALYS_BATCH_NOT_PUBLISHED");
    const labels = ["MERCALYS_SALES", "MERCALYS_WASTE"].flatMap((type) => {
      const ranges = mergeBusinessPeriods(
        periods.filter((p) => p.source_type === type),
      );
      return ranges.length
        ? [
            `${type === "MERCALYS_SALES" ? "ventes" : "casse"} : ${ranges.map((p) => `du ${p.start.split("-").reverse().join("/")} au ${p.end.split("-").reverse().join("/")}`).join(", ")}`,
          ]
        : [];
    });
    return `Analyse les imports publiés de ${labels.join(" ; ")}. Fais ressortir les résultats, les évolutions comparables et les actions utiles au rayon à partir des périodes disponibles.`;
  }
  async recent(after?: { createdAt: string; id: string }) {
    const rows = await this.db.getAllAsync<{ request_json: string }>(
      "SELECT request_json FROM mercalys_intake_batches WHERE store_id=? AND owner_id=? AND (? IS NULL OR conversation_id=?) AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 11",
      this.scope.storeId,
      this.scope.ownerId,
      this.scope.conversationId ?? null,
      this.scope.conversationId ?? null,
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
          b.storeId !== this.scope.storeId ||
          b.ownerId !== this.scope.ownerId ||
          (this.scope.conversationId !== undefined &&
            b.conversationId !== this.scope.conversationId),
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
  /** Resolve a replaced device copy without changing the immutable intake request. */
  async retainedLocation(batchId: string, itemId: string) {
    const item = await this.readItem(this.db, batchId, itemId);
    const rows = await this.db.getAllAsync<{ local_uri: string }>(
      `SELECT DISTINCT f.local_uri FROM source_documents d JOIN local_files f ON f.source_document_id=d.id AND f.store_id=d.store_id
       WHERE d.store_id=? AND d.checksum=? AND d.deleted_at IS NULL AND d.source_type IN ('MERCALYS_SALES','MERCALYS_WASTE')
       AND f.checksum=d.checksum AND f.size_bytes=? AND f.local_uri=d.local_file_uri AND f.retention_status='RETAINED'
       AND EXISTS (SELECT 1 FROM source_original_restorations h WHERE h.store_id=d.store_id AND h.source_document_id=d.id AND h.local_file_id=f.id AND h.restored_uri=f.local_uri) LIMIT 2`,
      this.scope.storeId,
      item.checksum,
      item.sizeBytes,
    );
    if (rows.length > 1) throw Error("MERCALYS_RESTORED_LOCATION_AMBIGUOUS");
    return rows[0]?.local_uri ?? item.localUri;
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
  async saveAssistance(
    batchId: string,
    itemId: string,
    expectedVersion: number,
    assistance: NonNullable<
      ReturnType<typeof mercalysBatchItemSchema.parse>["assistance"]
    >,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const current = await this.readItem(tx, batchId, itemId);
      if (current.version !== expectedVersion)
        throw Error("MERCALYS_BATCH_ITEM_CHANGED");
      const next = mercalysBatchItemSchema.parse({
        ...current,
        assistance,
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
