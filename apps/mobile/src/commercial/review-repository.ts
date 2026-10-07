import {
  commercialReviewPageSchema,
  commercialReviewDecisionSchema,
  synchronizedCommercialReviewDecisionSchema,
  type CommercialReviewPage,
  type CommercialReviewDecision,
} from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { runAtomicLocalMutation } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
export async function applyCommercialReviewEntity(
  db: OutboxDatabase,
  storeId: string,
  type: string,
  payload: unknown,
) {
  if (type === "commercial_review_page") {
    const page = commercialReviewPageSchema.parse(payload);
    if (page.storeId !== storeId)
      throw Error("COMMERCIAL_REVIEW_STORE_MISMATCH");
    const existing = await db.getFirstAsync<{
      store_id: string;
      payload_json: string;
    }>(
      "SELECT store_id,payload_json FROM commercial_review_pages WHERE id = ?",
      page.id,
    );
    if (
      existing &&
      (existing.store_id !== storeId ||
        existing.payload_json !== JSON.stringify(page))
    )
      throw Error("COMMERCIAL_REVIEW_IMMUTABLE_PAGE");
    await db.runAsync(
      "INSERT OR IGNORE INTO commercial_review_pages (id,store_id,source_document_id,page_number,payload_json,remote_version) VALUES (?,?,?,?,?,1)",
      page.id,
      storeId,
      page.sourceDocumentId,
      page.pageNumber,
      JSON.stringify(page),
    );
    return;
  }
  if (type !== "commercial_review_decision")
    throw Error("COMMERCIAL_REVIEW_TYPE_INVALID");
  const entity = synchronizedCommercialReviewDecisionSchema.parse(payload);
  if (entity.storeId !== storeId)
    throw Error("COMMERCIAL_REVIEW_STORE_MISMATCH");
  const d = entity.decision;
  const pageRow = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_review_pages WHERE id = ? AND store_id = ?",
    d.pageId,
    storeId,
  );
  const page = pageRow
    ? commercialReviewPageSchema.parse(JSON.parse(pageRow.payload_json))
    : null;
  const block = page?.blocks.find(
    (b) => b.sourceBlockIndex === d.sourceBlockIndex,
  );
  if (
    !page ||
    page.sourceDocumentId !== d.sourceDocumentId ||
    page.checksum !== d.checksum ||
    !block ||
    d.corrections.some(
      (c) => block.fields.filter((f) => f.name === c.name).length !== 1,
    )
  )
    throw Error("COMMERCIAL_REVIEW_SOURCE_INVALID");
  const old = await db.getFirstAsync<{
    store_id: string;
    payload_json: string;
  }>(
    "SELECT store_id,payload_json FROM commercial_review_decisions WHERE id = ?",
    d.id,
  );
  if (
    old &&
    (old.store_id !== storeId || old.payload_json !== JSON.stringify(d))
  )
    throw Error("COMMERCIAL_REVIEW_IMMUTABLE_DECISION");
  await db.runAsync(
    `INSERT INTO commercial_review_decisions(id,store_id,page_id,source_block_index,payload_json,remote_version,sync_state) VALUES (?,?,?,?,?,1,'SYNCED') ON CONFLICT(id) DO UPDATE SET remote_version=1,sync_state='SYNCED'`,
    d.id,
    storeId,
    d.pageId,
    d.sourceBlockIndex,
    JSON.stringify(d),
  );
}
export class CommercialReviewRepository {
  constructor(private readonly db: OutboxDatabase & AtomicMutationDatabase) {}
  async pages(storeId: string, sourceDocumentId?: string) {
    const rows = await this.db.getAllAsync<{ payload_json: string }>(
      `SELECT payload_json FROM commercial_review_pages WHERE store_id = ? ${sourceDocumentId ? "AND source_document_id = ?" : ""} ORDER BY source_document_id,page_number`,
      ...(sourceDocumentId ? [storeId, sourceDocumentId] : [storeId]),
    );
    return rows.map((row) =>
      commercialReviewPageSchema.parse(JSON.parse(row.payload_json)),
    );
  }
  async decisions(storeId: string) {
    const rows = await this.db.getAllAsync<{
      payload_json: string;
      sync_state: string;
      outbox_status: string | null;
    }>(
      `SELECT d.payload_json,d.sync_state,o.status AS outbox_status FROM commercial_review_decisions d LEFT JOIN sync_outbox o ON o.entity_id = d.id AND o.store_id = d.store_id WHERE d.store_id = ? AND d.sync_state <> 'SUPERSEDED'`,
      storeId,
    );
    return rows.map((row) => ({
      decision: commercialReviewDecisionSchema.parse(
        JSON.parse(row.payload_json),
      ),
      state:
        row.outbox_status === "CONFLICT"
          ? "CONFLICT"
          : row.outbox_status === "FAILED"
            ? "FAILED"
            : row.sync_state,
    }));
  }
  async review(
    input: CommercialReviewDecision,
    deviceId: string,
    commandId: string,
  ) {
    const decision = commercialReviewDecisionSchema.parse(input);
    await runAtomicLocalMutation(this.db, {
      outbox: {
        commandId,
        deviceId,
        storeId: decision.storeId,
        entityType: "commercial_review_decision",
        entityId: decision.id,
        commandType: "COMMERCIAL_TRANSCRIPTION_REVIEW",
        expectedRemoteVersion: null,
        payload: decision,
      },
      mutate: async (tx) => {
        const row = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM commercial_review_pages WHERE id = ? AND store_id = ?",
          decision.pageId,
          decision.storeId,
        );
        if (!row) throw Error("COMMERCIAL_REVIEW_SOURCE_MISSING");
        const page = commercialReviewPageSchema.parse(
          JSON.parse(row.payload_json),
        );
        const block = page.blocks.find(
          (b) => b.sourceBlockIndex === decision.sourceBlockIndex,
        );
        if (
          page.checksum !== decision.checksum ||
          page.sourceDocumentId !== decision.sourceDocumentId ||
          !block ||
          decision.corrections.some(
            (c) => block.fields.filter((f) => f.name === c.name).length !== 1,
          )
        )
          throw Error("COMMERCIAL_REVIEW_SOURCE_INVALID");
        const prior = await tx.getFirstAsync(
          "SELECT id FROM commercial_review_decisions WHERE store_id = ? AND page_id = ? AND source_block_index = ? AND sync_state <> 'SUPERSEDED'",
          decision.storeId,
          decision.pageId,
          decision.sourceBlockIndex,
        );
        if (prior) throw Error("COMMERCIAL_REVIEW_ALREADY_RECORDED");
        await tx.runAsync(
          "INSERT INTO commercial_review_decisions (id,store_id,page_id,source_block_index,payload_json,remote_version,sync_state) VALUES (?,?,?,?,?,NULL,'PENDING')",
          decision.id,
          decision.storeId,
          decision.pageId,
          decision.sourceBlockIndex,
          JSON.stringify(decision),
        );
      },
    });
  }
  async useRemoteDecision(storeId: string, localId: string, remoteId: string) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const rows = await tx.getAllAsync<{
        id: string;
        page_id: string;
        source_block_index: number;
        sync_state: string;
      }>(
        "SELECT id,page_id,source_block_index,sync_state FROM commercial_review_decisions WHERE store_id = ? AND id IN (?,?)",
        storeId,
        localId,
        remoteId,
      );
      const local = rows.find((r) => r.id === localId),
        remote = rows.find((r) => r.id === remoteId);
      if (
        !local ||
        !remote ||
        remote.sync_state !== "SYNCED" ||
        local.page_id !== remote.page_id ||
        local.source_block_index !== remote.source_block_index
      )
        throw Error("COMMERCIAL_REVIEW_RESOLUTION_INVALID");
      const changed = await tx.runAsync(
        "UPDATE sync_outbox SET status = 'ACKNOWLEDGED' WHERE store_id = ? AND entity_id = ? AND entity_type = 'commercial_review_decision' AND status = 'CONFLICT'",
        storeId,
        localId,
      );
      if (Number(changed.changes) !== 1)
        throw Error("COMMERCIAL_REVIEW_RESOLUTION_INVALID");
      await tx.runAsync(
        "UPDATE commercial_review_decisions SET sync_state = 'SUPERSEDED' WHERE store_id = ? AND id = ?",
        storeId,
        localId,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status = 'RESOLVED_REMOTE',resolved_at = ? WHERE store_id = ? AND entity_id = ? AND entity_type = 'commercial_review_decision' AND status = 'OPEN'",
        new Date().toISOString(),
        storeId,
        localId,
      );
    });
  }
}
export function reviewProgress(
  pages: CommercialReviewPage[],
  decisions: Array<{ decision: CommercialReviewDecision; state: string }>,
) {
  const total = pages.reduce((n, p) => n + p.blocks.length, 0);
  const examined = new Set(
    decisions
      .filter((d) =>
        pages.some(
          (p) =>
            p.id === d.decision.pageId &&
            p.blocks.some(
              (b) => b.sourceBlockIndex === d.decision.sourceBlockIndex,
            ),
        ),
      )
      .map((d) => `${d.decision.pageId}:${d.decision.sourceBlockIndex}`),
  ).size;
  return { total, examined, remaining: total - examined };
}
