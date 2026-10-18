import {
  receiptCorrectionAuthoritySchema,
  receiptCorrectionRequestSchema,
  receiptCorrectionResultSchema,
  readReceiptCorrectionProposal,
  type ReceiptCorrectionAuthority,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
import { readReceiptCorrectionReview } from "./receipt-correction-review";
import { verifyPrivateToolRecord } from "./private-tool-record";
async function proof(
  db: OutboxDatabase,
  scope: {
    storeId: string;
    ownerId: string;
    conversationId: string;
    userMessageId: string;
  },
  id: string,
) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    id,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  if (!row) throw Error("RECEIPT_CORRECTION_REVIEW_REQUIRED");
  const artifact = readReceiptCorrectionProposal(JSON.parse(row.payload_json));
  await verifyPrivateToolRecord(
    db,
    scope,
    artifact.message,
    artifact.content.assistantMessageId,
  );
  if (artifact.message.replyToMessageId !== scope.userMessageId)
    throw Error("RECEIPT_CORRECTION_SCOPE");
  return artifact;
}
export class CopilotReceiptCorrectionRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: ReceiptCorrectionAuthority,
    signal?: AbortSignal,
  ) {
    const request = receiptCorrectionRequestSchema.parse(raw),
      authority = receiptCorrectionAuthoritySchema.parse(rawAuthority);
    if (!authority.canCorrectWaste || !authority.correctionReviewed)
      throw Error("RECEIPT_CORRECTION_REVIEW_REQUIRED");
    const { canCorrectWaste, correctionReviewed, ...scope } = authority;
    void correctionReviewed;
    const artifact = await proof(this.db, scope, request.operationId);
    if (artifact.content.source.sourceDocumentId !== request.sourceDocumentId)
      throw Error("RECEIPT_CORRECTION_SCOPE");
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canCorrectWaste },
      receiptCorrectionResultSchema,
      async (tx, ctx) => {
        const { content } = await proof(tx, ctx, request.operationId),
          review = await readReceiptCorrectionReview(
            tx,
            content.source,
            content.input,
            this.digest,
          );
        if (
          review.status !== "READY" ||
          request.receiptId !== review.current.receipt.id ||
          request.basisHash !== review.basisHash
        )
          throw Error("RECEIPT_CORRECTION_STALE");
        const repo = new WasteReceiptRepository(joinedProductToolDatabase(tx)),
          appliedAt = this.now();
        if (review.header.wasteDate !== undefined)
          await repo.confirmWasteDate(
            request.receiptId,
            review.header.wasteDate,
          );
        if (review.header.cashierNumber !== undefined)
          await repo.confirmCashierNumber(
            request.receiptId,
            review.header.cashierNumber ?? "",
            appliedAt,
          );
        for (const update of review.updates) {
          if (update.values)
            await repo.updateLineValues(
              request.receiptId,
              update.lineId,
              update.values,
            );
          if (update.productId !== undefined)
            await repo.selectProductCandidate(
              request.receiptId,
              update.lineId,
              update.productId,
            );
          if (update.excluded !== undefined)
            await repo.setLineExcluded(
              request.receiptId,
              update.lineId,
              update.excluded,
            );
        }
        const after = await readReceiptCorrectionReview(
          tx,
          content.source,
          content.input,
          this.digest,
        );
        return {
          ...request,
          userMessageId: ctx.userMessageId,
          appliedAt,
          afterHash: after.basisHash,
          changes: review.changes,
        };
      },
      signal,
    );
  }
}
export class CopilotReceiptCorrectionController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canCorrectWaste: boolean;
    },
    private digest: (s: string) => Promise<string>,
  ) {}
  async open(raw: CopilotMessage) {
    const artifact = readReceiptCorrectionProposal(raw),
      { message, content } = artifact;
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const journal = await this.db.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (journal) {
      const result = receiptCorrectionResultSchema.parse(
          JSON.parse(journal.result_json),
        ),
        request = receiptCorrectionRequestSchema.parse(
          JSON.parse(journal.request_json),
        );
      if (
        journal.store_id !== message.storeId ||
        journal.owner_id !== message.ownerId ||
        journal.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        request.operationId !== message.id ||
        result.sourceDocumentId !== content.input.sourceDocumentId ||
        request.sourceDocumentId !== result.sourceDocumentId ||
        request.receiptId !== result.receiptId ||
        request.basisHash !== result.basisHash
      )
        throw Error("RECEIPT_CORRECTION_SCOPE");
      return {
        ...artifact,
        status: "COMPLETED" as const,
        review: null,
        result,
      };
    }
    const review = await readReceiptCorrectionReview(
      this.db,
      content.source,
      content.input,
      this.digest,
    );
    return { ...artifact, status: review.status, review, result: null };
  }
  async confirm(
    message: CopilotMessage,
    basisHash: string,
    reviewed: boolean,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canCorrectWaste || !reviewed)
      throw Error("RECEIPT_CORRECTION_REVIEW_REQUIRED");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY" || state.review?.basisHash !== basisHash)
      throw Error("RECEIPT_CORRECTION_STALE");
    const request = receiptCorrectionRequestSchema.parse({
      operationId: message.id,
      sourceDocumentId: state.content.source.sourceDocumentId,
      receiptId: state.review.current.receipt.id,
      basisHash,
    });
    await new CopilotReceiptCorrectionRuntime(this.db, this.digest).execute(
      request,
      {
        ...this.scope,
        correctionReviewed: true,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: JSON.stringify(request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
