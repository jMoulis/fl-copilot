import {
  receiptPublicationRequestSchema,
  receiptPublicationResultSchema,
  receiptPublicationAuthoritySchema,
  readReceiptPublicationProposal,
  type ReceiptPublicationAuthority,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { WasteReceiptPublicationRepository } from "../documents/waste-receipt-publication";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
import { readNativeReceiptPublicationReview } from "./receipt-publication-review";
import { verifyPrivateToolRecord } from "./private-tool-record";
async function proof(
  db: OutboxDatabase,
  scope: {
    storeId: string;
    ownerId: string;
    conversationId: string;
    userMessageId: string;
  },
  operationId: string,
) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    operationId,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  if (!row) throw Error("RECEIPT_PUBLICATION_REVIEW_REQUIRED");
  const artifact = readReceiptPublicationProposal(JSON.parse(row.payload_json));
  await verifyPrivateToolRecord(
    db,
    scope,
    artifact.message,
    artifact.content.assistantMessageId,
  );
  if (artifact.message.replyToMessageId !== scope.userMessageId)
    throw Error("RECEIPT_PUBLICATION_SCOPE");
  return artifact;
}
export class CopilotReceiptPublicationRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (text: string) => Promise<string>,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: ReceiptPublicationAuthority,
    signal?: AbortSignal,
  ) {
    const request = receiptPublicationRequestSchema.parse(raw),
      authority = receiptPublicationAuthoritySchema.parse(rawAuthority);
    if (!authority.canPublishWaste || !authority.receiptReviewed)
      throw Error("RECEIPT_PUBLICATION_REVIEW_REQUIRED");
    const { canPublishWaste, receiptReviewed, ...scope } = authority;
    void receiptReviewed;
    const artifact = await proof(this.db, scope, request.operationId);
    if (artifact.content.source.sourceDocumentId !== request.sourceDocumentId)
      throw Error("RECEIPT_PUBLICATION_SCOPE");
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canPublishWaste },
      receiptPublicationResultSchema,
      async (tx, ctx) => {
        const currentProof = await proof(tx, ctx, request.operationId);
        const review = await readNativeReceiptPublicationReview(
          tx,
          currentProof.content.source,
          this.digest,
        );
        if (
          request.sourceDocumentId !==
            currentProof.content.source.sourceDocumentId ||
          request.receiptId !== review.receipt.id ||
          request.basisHash !== review.basisHash ||
          review.receipt.processingStatus === "PUBLISHED"
        )
          throw Error("RECEIPT_PUBLICATION_STALE");
        if (review.issues.length) throw Error("RECEIPT_PUBLICATION_BLOCKED");
        const appliedAt = this.now(),
          commandId = this.id();
        const result = await new WasteReceiptPublicationRepository(
          joinedProductToolDatabase(tx),
        ).publish({
          receiptId: request.receiptId,
          storeId: ctx.storeId,
          deviceId: ctx.deviceId,
          commandId,
          analyticsJobId: this.id(),
          timestamp: appliedAt,
        });
        return {
          ...request,
          userMessageId: ctx.userMessageId,
          appliedAt,
          commandId,
          publishedCount: result.publishedCount,
        };
      },
      signal,
    );
  }
}
export class CopilotReceiptPublicationController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canPublishWaste: boolean;
    },
    private digest: (text: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const artifact = readReceiptPublicationProposal(raw),
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
      const result = receiptPublicationResultSchema.parse(
          JSON.parse(journal.result_json),
        ),
        request = receiptPublicationRequestSchema.parse(
          JSON.parse(journal.request_json),
        );
      if (
        journal.store_id !== message.storeId ||
        journal.owner_id !== message.ownerId ||
        journal.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        request.operationId !== message.id ||
        result.sourceDocumentId !== content.source.sourceDocumentId ||
        request.sourceDocumentId !== result.sourceDocumentId ||
        request.receiptId !== result.receiptId ||
        request.basisHash !== result.basisHash
      )
        throw Error("RECEIPT_PUBLICATION_SCOPE");
      return {
        ...artifact,
        status: "COMPLETED" as const,
        review: null,
        result,
      };
    }
    const review = await readNativeReceiptPublicationReview(
      this.db,
      content.source,
      this.digest,
    );
    return {
      ...artifact,
      status:
        review.receipt.processingStatus === "PUBLISHED"
          ? ("ALREADY_PUBLISHED" as const)
          : review.issues.length
            ? ("BLOCKED" as const)
            : ("READY" as const),
      review,
      result: null,
    };
  }
  async confirm(
    message: CopilotMessage,
    basisHash: string,
    reviewed: boolean,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canPublishWaste || !reviewed)
      throw Error("RECEIPT_PUBLICATION_REVIEW_REQUIRED");
    const state = await this.open(message);
    if (state.status === "COMPLETED" || state.status === "ALREADY_PUBLISHED")
      return state;
    if (state.status !== "READY" || state.review.basisHash !== basisHash)
      throw Error("RECEIPT_PUBLICATION_STALE");
    const request = receiptPublicationRequestSchema.parse({
      operationId: message.id,
      sourceDocumentId: state.content.source.sourceDocumentId,
      receiptId: state.review.receipt.id,
      basisHash,
    });
    await new CopilotReceiptPublicationRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      request,
      {
        ...this.scope,
        receiptReviewed: true,
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
