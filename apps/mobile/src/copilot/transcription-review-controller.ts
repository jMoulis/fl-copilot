import { z } from "zod";
import {
  readTranscriptionReviewProposal,
  transcriptionReviewRequestSchema,
  transcriptionReviewResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  commercialReviewDecisionSchema,
  commercialReviewPageSchema,
} from "@fl-copilot/sync-contracts";
import { CommercialReviewRepository } from "../commercial/review-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  joinedProductToolDatabase,
  runReviewedStoreOperation,
} from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
type Scope = {
  storeId: string;
  ownerId: string;
  deviceId: string;
  canReviewTranscriptions: boolean;
};
type Database = OutboxDatabase & AtomicMutationDatabase;
type Artifact = ReturnType<typeof readTranscriptionReviewProposal>;
export class CopilotTranscriptionReviewController {
  constructor(
    private db: Database,
    private scope: Scope,
    private digest: (s: string) => Promise<string>,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  private async proof(db: OutboxDatabase, raw: CopilotMessage) {
    const artifact = readTranscriptionReviewProposal(raw);
    await verifyPrivateToolRecord(
      db,
      this.scope,
      artifact.message,
      artifact.content.assistantMessageId,
    );
    return artifact;
  }
  private async source(db: OutboxDatabase, artifact: Artifact) {
    const s = artifact.content.source;
    const row = await db.getFirstAsync<{
      source_type: string;
      checksum: string;
      deleted_at: string | null;
    }>(
      "SELECT source_type,checksum,deleted_at FROM source_documents WHERE id=? AND store_id=?",
      s.sourceDocumentId,
      this.scope.storeId,
    );
    if (
      !row ||
      row.source_type !== "WEEKLY_COMMERCIAL_PDF" ||
      row.deleted_at ||
      row.checksum !== s.checksum
    )
      throw Error("TRANSCRIPTION_REVIEW_SOURCE_CHANGED");
  }
  private async operationId(messageId: string, localId: string) {
    z.uuid().parse(localId);
    const h = await this.digest(
      JSON.stringify(["copilot-transcription-adoption-v1", messageId, localId]),
    );
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(h);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  private async read(db: OutboxDatabase, artifact: Artifact, localId: string) {
    await this.source(db, artifact);
    const review = await new CommercialReviewRepository(
      joinedProductToolDatabase(db),
      this.digest,
      this.now,
    ).reviewConflict(this.scope.storeId, localId, this.scope.ownerId);
    const s = artifact.content.source;
    if (
      review.local.sourceDocumentId !== s.sourceDocumentId ||
      review.local.checksum !== s.checksum ||
      review.page?.sourceDocumentId !== s.sourceDocumentId ||
      review.page.checksum !== s.checksum ||
      (review.remote && review.remote.sourceDocumentId !== s.sourceDocumentId)
    )
      throw Error("TRANSCRIPTION_REVIEW_SCOPE_INVALID");
    return review;
  }
  async list(raw: CopilotMessage, afterId: string | null = null) {
    if (afterId) z.uuid().parse(afterId);
    let result:
      | {
          artifact: Artifact;
          items: {
            id: string;
            pageNumber: number;
            sourceBlockIndex: number;
            label: string;
          }[];
          nextCursor: string | null;
          completed: z.infer<typeof transcriptionReviewResultSchema>[];
        }
      | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const artifact = await this.proof(tx, raw);
      await this.source(tx, artifact);
      const s = artifact.content.source;
      const rows = await tx.getAllAsync<{
        payload_json: string;
        page_json: string;
      }>(
        `SELECT d.payload_json,p.payload_json AS page_json FROM commercial_review_decisions d JOIN commercial_review_pages p ON p.id=d.page_id AND p.store_id=d.store_id WHERE d.store_id=? AND p.source_document_id=? AND json_extract(d.payload_json,'$.sourceDocumentId')=? AND json_extract(d.payload_json,'$.checksum')=? AND json_extract(p.payload_json,'$.checksum')=? AND d.sync_state IN ('PENDING','CONFLICT','ERROR') AND (? IS NULL OR d.id>?) AND EXISTS (SELECT 1 FROM sync_conflicts c WHERE c.store_id=d.store_id AND c.entity_type='commercial_review_decision' AND c.entity_id=d.id AND c.status='OPEN') ORDER BY d.id LIMIT 11`,
        this.scope.storeId,
        s.sourceDocumentId,
        s.sourceDocumentId,
        s.checksum,
        s.checksum,
        afterId,
        afterId,
      );
      const items = rows.slice(0, 10).map((row) => {
        const d = commercialReviewDecisionSchema.parse(
            JSON.parse(row.payload_json),
          ),
          p = commercialReviewPageSchema.parse(JSON.parse(row.page_json));
        if (
          d.storeId !== this.scope.storeId ||
          p.storeId !== this.scope.storeId ||
          d.sourceDocumentId !== s.sourceDocumentId ||
          p.sourceDocumentId !== s.sourceDocumentId ||
          d.pageId !== p.id ||
          d.checksum !== s.checksum ||
          p.checksum !== s.checksum
        )
          throw Error("TRANSCRIPTION_REVIEW_SCOPE_INVALID");
        const block = p.blocks.find(
          (b) => b.sourceBlockIndex === d.sourceBlockIndex,
        );
        return {
          id: d.id,
          pageNumber: p.pageNumber,
          sourceBlockIndex: d.sourceBlockIndex,
          label: (block?.label ?? "Extrait à comparer").slice(0, 240),
        };
      });
      const completedRows = await tx.getAllAsync<{ result_json: string }>(
        "SELECT result_json FROM copilot_tool_results WHERE store_id=? AND owner_id=? AND conversation_id=? AND json_extract(request_json,'$.proposalMessageId')=? ORDER BY operation_id LIMIT 10",
        this.scope.storeId,
        this.scope.ownerId,
        raw.conversationId,
        raw.id,
      );
      const completed = completedRows.map((row) => {
        const value = transcriptionReviewResultSchema.parse(
          JSON.parse(row.result_json),
        );
        if (
          value.proposalMessageId !== raw.id ||
          value.sourceDocumentId !== s.sourceDocumentId ||
          value.userMessageId !== raw.replyToMessageId
        )
          throw Error("TRANSCRIPTION_REVIEW_SCOPE_INVALID");
        return value;
      });
      result = {
        artifact,
        items,
        completed,
        nextCursor: rows.length > 10 ? items[items.length - 1]!.id : null,
      };
    });
    return result!;
  }
  async review(raw: CopilotMessage, localId: string) {
    const operationId = await this.operationId(raw.id, localId);
    let result:
      | {
          status: "COMPLETED";
          result: z.infer<typeof transcriptionReviewResultSchema>;
          review: null;
        }
      | {
          status: "READY" | "BLOCKED";
          result: null;
          review: Awaited<
            ReturnType<CopilotTranscriptionReviewController["read"]>
          >;
        }
      | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const artifact = await this.proof(tx, raw);
      const old = await tx.getFirstAsync<{
        store_id: string;
        owner_id: string;
        conversation_id: string;
        result_json: string;
        request_json: string;
      }>(
        "SELECT * FROM copilot_tool_results WHERE operation_id=?",
        operationId,
      );
      if (old) {
        const r = transcriptionReviewResultSchema.parse(
            JSON.parse(old.result_json),
          ),
          request = transcriptionReviewRequestSchema.parse(
            JSON.parse(old.request_json),
          );
        if (
          old.store_id !== this.scope.storeId ||
          old.owner_id !== this.scope.ownerId ||
          old.conversation_id !== raw.conversationId ||
          r.operationId !== operationId ||
          r.localId !== localId ||
          r.proposalMessageId !== raw.id ||
          r.sourceDocumentId !== artifact.content.source.sourceDocumentId ||
          r.userMessageId !== raw.replyToMessageId ||
          request.operationId !== operationId ||
          request.localId !== localId ||
          request.proposalMessageId !== raw.id ||
          request.basisHash !== r.basisHash
        )
          throw Error("TRANSCRIPTION_REVIEW_SCOPE_INVALID");
        result = { status: "COMPLETED", result: r, review: null };
        return;
      }
      const review = await this.read(tx, artifact, localId);
      result = {
        status:
          review.canResolve &&
          review.commands.every((c) => c.device_id === this.scope.deviceId)
            ? "READY"
            : "BLOCKED",
        review,
        result: null,
      };
    });
    return result!;
  }
  async confirm(
    raw: CopilotMessage,
    localId: string,
    basisHash: string,
    comparisonReviewed: boolean,
    signal?: AbortSignal,
    canContinue: () => boolean = () => true,
  ) {
    if (
      !this.scope.canReviewTranscriptions ||
      !comparisonReviewed ||
      !canContinue() ||
      signal?.aborted
    )
      throw Error("TRANSCRIPTION_REVIEW_FORBIDDEN");
    readTranscriptionReviewProposal(raw);
    const request = transcriptionReviewRequestSchema.parse({
      operationId: await this.operationId(raw.id, localId),
      proposalMessageId: raw.id,
      localId,
      basisHash,
    });
    const { canReviewTranscriptions, ...scope } = this.scope;
    let result: z.infer<typeof transcriptionReviewResultSchema> | undefined;
    await this.db.withExclusiveTransactionAsync(async (transaction) => {
      const artifact = await this.proof(transaction, raw);
      if (!canContinue() || signal?.aborted)
        throw Error("TRANSCRIPTION_REVIEW_FORBIDDEN");
      result = await runReviewedStoreOperation(
        joinedProductToolDatabase(transaction),
        request,
        {
          ...scope,
          canExecute: canReviewTranscriptions,
          conversationId: raw.conversationId,
          userMessageId: raw.replyToMessageId!,
          decisionLevel: "REVIEWED",
          authorizedRequestJson: JSON.stringify(request),
        },
        transcriptionReviewResultSchema,
        async (tx, ctx) => {
          const current = await this.proof(tx, artifact.message),
            review = await this.read(tx, current, localId);
          if (
            !canContinue() ||
            signal?.aborted ||
            !review.canResolve ||
            !review.remote ||
            review.hash !== request.basisHash ||
            review.commands.some((c) => c.device_id !== ctx.deviceId)
          )
            throw Error("TRANSCRIPTION_REVIEW_STALE");
          const appliedAt = this.now();
          await new CommercialReviewRepository(
            joinedProductToolDatabase(tx),
            this.digest,
            () => appliedAt,
          ).useRemoteDecision(ctx.storeId, localId, review.remote.id, {
            actorId: ctx.ownerId,
            deviceId: ctx.deviceId,
            actionId: request.operationId,
            reviewHash: review.hash,
            signal,
            canResolve: () => canContinue() && !signal?.aborted,
          });
          if (!canContinue() || signal?.aborted)
            throw Error("TRANSCRIPTION_REVIEW_STALE");
          return {
            ...request,
            userMessageId: ctx.userMessageId,
            appliedAt,
            sourceDocumentId: current.content.source.sourceDocumentId,
            remoteId: review.remote.id,
            pageId: review.local.pageId,
            pageNumber: review.page!.pageNumber,
            sourceBlockIndex: review.local.sourceBlockIndex,
            decision: "ADOPT_REMOTE" as const,
          };
        },
        signal,
      );
      if (!canContinue() || signal?.aborted)
        throw Error("TRANSCRIPTION_REVIEW_STALE");
    });
    return result!;
  }
}
