import { currentCommercialAnalysisPages } from "@fl-copilot/commercial-core";
import { z } from "zod";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  readTranscriptionConflict,
  assertTranscriptionCurrent,
  type TranscriptionLifetime,
} from "./transcription-conflict-review";
import { buildCommercialDocumentSummary } from "@fl-copilot/commercial-core";
import {
  OutboxRepository,
  notifyOutboxChanged,
} from "../sync/outbox-repository";
import {
  commercialReviewPageSchema,
  commercialReviewDecisionSchema,
  synchronizedCommercialReviewDecisionSchema,
  type CommercialReviewPage,
  type CommercialReviewDecision,
} from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runAtomicLocalMutation,
  joinedMutationDatabase,
} from "../sync/atomic-local-mutation";
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
  constructor(
    private readonly db: OutboxDatabase & AtomicMutationDatabase,
    private readonly digest: (value: string) => Promise<string> = async () => {
      throw Error("COMMERCIAL_REVIEW_COMPARISON_UNAVAILABLE");
    },
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  reviewConflict(storeId: string, localId: string, actorId: string) {
    return readTranscriptionConflict(
      this.db,
      storeId,
      localId,
      actorId,
      this.digest,
    );
  }
  async pages(storeId: string, sourceDocumentId?: string) {
    const rows = await this.db.getAllAsync<{ payload_json: string }>(
      `SELECT payload_json FROM commercial_review_pages WHERE store_id = ? ${sourceDocumentId ? "AND source_document_id = ?" : ""} ORDER BY source_document_id,page_number`,
      ...(sourceDocumentId ? [storeId, sourceDocumentId] : [storeId]),
    );
    return currentCommercialAnalysisPages(
      rows.map((row) =>
        commercialReviewPageSchema.parse(JSON.parse(row.payload_json)),
      ),
    );
  }
  async decisions(storeId: string, sourceDocumentId?: string) {
    const rows = await this.db.getAllAsync<{
      payload_json: string;
      sync_state: string;
      outbox_priority: number | null;
    }>(
      `SELECT d.payload_json,d.sync_state,o.outbox_priority FROM commercial_review_decisions d
       LEFT JOIN (SELECT entity_id,MAX(CASE WHEN status='CONFLICT' THEN 3 WHEN status='FAILED' AND COALESCE(last_error_code,'')<>'COMMERCIAL_REVIEW_SUPERSEDED' THEN 2 ELSE 0 END) AS outbox_priority FROM sync_outbox WHERE store_id=? AND entity_type='commercial_review_decision' GROUP BY entity_id) o ON o.entity_id=d.id
       WHERE d.store_id=? AND d.sync_state<>'SUPERSEDED' ${sourceDocumentId ? "AND d.page_id IN (SELECT id FROM commercial_review_pages WHERE store_id=? AND source_document_id=?)" : ""}`,
      storeId,
      storeId,
      ...(sourceDocumentId ? [storeId, sourceDocumentId] : []),
    );
    return rows.map((row) => ({
      decision: commercialReviewDecisionSchema.parse(
        JSON.parse(row.payload_json),
      ),
      state:
        row.outbox_priority === 3
          ? "CONFLICT"
          : row.outbox_priority === 2
            ? "FAILED"
            : row.sync_state,
    }));
  }
  async review(
    input: CommercialReviewDecision,
    deviceId: string,
    commandId: string,
    lifetime?: TranscriptionLifetime,
  ) {
    assertTranscriptionCurrent(lifetime);
    const decision = commercialReviewDecisionSchema.parse(input);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      assertTranscriptionCurrent(lifetime);
      await runAtomicLocalMutation(joinedMutationDatabase(tx), {
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
      assertTranscriptionCurrent(lifetime);
    });
  }
  async reviewReadableGroup(
    input: {
      storeId: string;
      sourceDocumentId: string;
      deviceId: string;
      reviewedAt: string;
      entries: Array<{
        pageId: string;
        sourceBlockIndex: number;
        id: string;
        commandId: string;
      }>;
    },
    lifetime?: TranscriptionLifetime,
  ) {
    assertTranscriptionCurrent(lifetime);
    if (
      !input.entries.length ||
      input.entries.length > 100 ||
      new Set(input.entries.map((e) => `${e.pageId}:${e.sourceBlockIndex}`))
        .size !== input.entries.length
    )
      throw Error("COMMERCIAL_GROUP_REVIEW_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      assertTranscriptionCurrent(lifetime);
      const rows = await tx.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM commercial_review_pages WHERE store_id = ? AND source_document_id = ?",
        input.storeId,
        input.sourceDocumentId,
      );
      const pages = currentCommercialAnalysisPages(
        rows.map((row) =>
          commercialReviewPageSchema.parse(JSON.parse(row.payload_json)),
        ),
      );
      const decisionRows = await tx.getAllAsync<{
        payload_json: string;
        sync_state: string;
      }>(
        "SELECT payload_json,sync_state FROM commercial_review_decisions WHERE store_id = ? AND sync_state <> 'SUPERSEDED'",
        input.storeId,
      );
      const decisions = decisionRows.map((row) => ({
        decision: commercialReviewDecisionSchema.parse(
          JSON.parse(row.payload_json),
        ),
        state: row.sync_state,
      }));
      const eligible = buildCommercialDocumentSummary(
        pages,
        decisions,
      ).bulkEligible;
      const selected = input.entries.map((entry) => {
        const item = eligible.find(
          (item) =>
            item.page.id === entry.pageId &&
            item.block.sourceBlockIndex === entry.sourceBlockIndex,
        );
        if (!item) throw Error("COMMERCIAL_GROUP_REVIEW_UNSAFE");
        return {
          entry,
          decision: commercialReviewDecisionSchema.parse({
            id: entry.id,
            storeId: input.storeId,
            sourceDocumentId: input.sourceDocumentId,
            pageId: entry.pageId,
            sourceBlockIndex: entry.sourceBlockIndex,
            checksum: item.page.checksum,
            decision: "CONFIRMED_TRANSCRIPTION",
            corrections: [],
            reviewedAt: input.reviewedAt,
          }),
        };
      });
      for (const { entry, decision } of selected) {
        await tx.runAsync(
          "INSERT INTO commercial_review_decisions(id,store_id,page_id,source_block_index,payload_json,remote_version,sync_state) VALUES (?,?,?,?,?,NULL,'PENDING')",
          decision.id,
          input.storeId,
          decision.pageId,
          decision.sourceBlockIndex,
          JSON.stringify(decision),
        );
        await new OutboxRepository(tx).enqueue({
          commandId: entry.commandId,
          deviceId: input.deviceId,
          storeId: input.storeId,
          entityType: "commercial_review_decision",
          entityId: decision.id,
          commandType: "COMMERCIAL_TRANSCRIPTION_REVIEW",
          expectedRemoteVersion: null,
          payload: decision,
        });
      }
      assertTranscriptionCurrent(lifetime);
    });
  }
  async useRemoteDecision(
    storeId: string,
    localId: string,
    remoteId: string,
    context: TranscriptionLifetime & {
      actorId: string;
      deviceId: string;
      actionId: string;
      reviewHash: string;
    },
  ) {
    assertTranscriptionCurrent(context);
    z.uuid().parse(storeId);
    z.uuid().parse(localId);
    z.uuid().parse(remoteId);
    z.uuid().parse(context.actorId);
    z.uuid().parse(context.deviceId);
    z.uuid().parse(context.actionId);
    z.string().min(1).parse(context.reviewHash);
    const request = {
      storeId,
      localId,
      remoteId,
      actorId: context.actorId,
      deviceId: context.deviceId,
      reviewHash: context.reviewHash,
    };
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      assertTranscriptionCurrent(context);
      const replay = await new ConflictRepository(tx).getById(context.actionId);
      if (replay) {
        if (
          replay.entityType !== "commercial_review_decision" ||
          replay.conflictType !== "COMMERCIAL_TRANSCRIPTION_REVIEW_CAPTURE" ||
          replay.storeId !== storeId ||
          replay.entityId !== localId ||
          replay.status !== "RESOLVED_REMOTE" ||
          JSON.stringify(
            (replay.localPayload as { request?: unknown }).request,
          ) !== JSON.stringify(request)
        )
          throw Error("COMMERCIAL_REVIEW_COMMAND_REUSED");
        assertTranscriptionCurrent(context);
        return;
      }
      const review = await readTranscriptionConflict(
        tx,
        storeId,
        localId,
        context.actorId,
        this.digest,
      );
      assertTranscriptionCurrent(context);
      if (review.hash !== context.reviewHash || review.remote?.id !== remoteId)
        throw Error("COMMERCIAL_REVIEW_SOURCE_CHANGED");
      if (
        !review.canResolve ||
        review.commands.some((c) => c.device_id !== context.deviceId)
      )
        throw Error("COMMERCIAL_REVIEW_RESOLUTION_INVALID");
      for (const c of review.commands)
        await tx.runAsync(
          "UPDATE sync_outbox SET status='FAILED',last_error_code='COMMERCIAL_REVIEW_SUPERSEDED' WHERE command_id=? AND store_id=?",
          c.command_id,
          storeId,
        );
      await tx.runAsync(
        "UPDATE commercial_review_decisions SET sync_state='SUPERSEDED' WHERE id=? AND store_id=?",
        localId,
        storeId,
      );
      const at = this.now();
      for (const c of review.group)
        await tx.runAsync(
          "UPDATE sync_conflicts SET status='RESOLVED_REMOTE',resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
          at,
          c.id,
          storeId,
        );
      await tx.runAsync(
        "INSERT INTO sync_conflicts(id,store_id,command_id,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at,resolved_at) VALUES(?,?,NULL,'commercial_review_decision',?,?,?,NULL,1,'COMMERCIAL_TRANSCRIPTION_REVIEW_CAPTURE','RESOLVED_REMOTE',?,?)",
        context.actionId,
        storeId,
        localId,
        JSON.stringify({
          request,
          decision: review.local,
          conflictIds: review.group.map((c) => c.id),
          commandIds: review.commands.map((c) => c.command_id),
        }),
        JSON.stringify(review.remote),
        at,
        at,
      );
      assertTranscriptionCurrent(context);
    });
    notifyOutboxChanged();
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
