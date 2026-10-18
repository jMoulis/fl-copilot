import {
  receiptRecoveryRequestSchema,
  receiptRecoveryResultSchema,
  receiptRecoveryAuthoritySchema,
  readReceiptRecoveryProposal,
  type ReceiptRecoveryAuthority,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
import { readReceiptRecoveryReview } from "./receipt-recovery-review";
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
  if (!row) throw Error("RECEIPT_RECOVERY_REVIEW_REQUIRED");
  const artifact = readReceiptRecoveryProposal(JSON.parse(row.payload_json));
  await verifyPrivateToolRecord(
    db,
    scope,
    artifact.message,
    artifact.content.assistantMessageId,
  );
  if (artifact.message.replyToMessageId !== scope.userMessageId)
    throw Error("RECEIPT_RECOVERY_SCOPE");
  return artifact;
}
export class CopilotReceiptRecoveryRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: ReceiptRecoveryAuthority,
    signal?: AbortSignal,
  ) {
    const request = receiptRecoveryRequestSchema.parse(raw),
      authority = receiptRecoveryAuthoritySchema.parse(rawAuthority);
    if (!authority.canRecoverWaste || !authority.recoveryReviewed)
      throw Error("RECEIPT_RECOVERY_REVIEW_REQUIRED");
    const { canRecoverWaste, recoveryReviewed, ...scope } = authority;
    void recoveryReviewed;
    const initial = await proof(this.db, scope, request.operationId);
    if (
      initial.content.source.sourceDocumentId !== request.sourceDocumentId ||
      initial.content.input.action !== request.action
    )
      throw Error("RECEIPT_RECOVERY_SCOPE");
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canRecoverWaste },
      receiptRecoveryResultSchema,
      async (tx, ctx) => {
        const artifact = await proof(tx, ctx, request.operationId),
          review = await readReceiptRecoveryReview(
            tx,
            artifact.content.source,
            artifact.content.input.action,
            this.digest,
          );
        if (
          review.status !== "READY" ||
          review.current.receipt.id !== request.receiptId ||
          review.basisHash !== request.basisHash ||
          review.action !== request.action
        )
          throw Error("RECEIPT_RECOVERY_STALE");
        const repo = new WasteReceiptRepository(joinedProductToolDatabase(tx)),
          appliedAt = this.now();
        if (request.action === "RETRY_PROCESSING")
          await repo.retryProcessing(request.receiptId, appliedAt);
        else
          await repo.resolveExactDuplicate(
            request.receiptId,
            request.action,
            this.id(),
            appliedAt,
          );
        const after = await readReceiptRecoveryReview(
          tx,
          artifact.content.source,
          request.action,
          this.digest,
        );
        return {
          ...request,
          userMessageId: ctx.userMessageId,
          appliedAt,
          before: review.state,
          after: after.state,
        };
      },
      signal,
    );
  }
}
export class CopilotReceiptRecoveryController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canRecoverWaste: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    if (!this.scope.canRecoverWaste) throw Error("RECEIPT_RECOVERY_FORBIDDEN");
    const artifact = readReceiptRecoveryProposal(raw),
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
      const result = receiptRecoveryResultSchema.parse(
          JSON.parse(journal.result_json),
        ),
        request = receiptRecoveryRequestSchema.parse(
          JSON.parse(journal.request_json),
        );
      if (
        journal.store_id !== message.storeId ||
        journal.owner_id !== message.ownerId ||
        journal.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        result.sourceDocumentId !== content.source.sourceDocumentId ||
        result.action !== content.input.action ||
        JSON.stringify(request) !==
          JSON.stringify({
            operationId: result.operationId,
            sourceDocumentId: result.sourceDocumentId,
            receiptId: result.receiptId,
            basisHash: result.basisHash,
            action: result.action,
          })
      )
        throw Error("RECEIPT_RECOVERY_SCOPE");
      return {
        ...artifact,
        status: "COMPLETED" as const,
        review: null,
        result,
      };
    }
    const review = await readReceiptRecoveryReview(
      this.db,
      content.source,
      content.input.action,
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
    if (!this.scope.canRecoverWaste || !reviewed)
      throw Error("RECEIPT_RECOVERY_REVIEW_REQUIRED");
    const state = await this.open(message);
    if (
      state.status === "COMPLETED" ||
      state.status === "UNCHANGED" ||
      state.status === "READ_ONLY"
    )
      return state;
    if (state.status !== "READY" || state.review?.basisHash !== basisHash)
      throw Error("RECEIPT_RECOVERY_STALE");
    const request = receiptRecoveryRequestSchema.parse({
      operationId: message.id,
      sourceDocumentId: state.content.source.sourceDocumentId,
      receiptId: state.review.current.receipt.id,
      basisHash,
      action: state.content.input.action,
    });
    await new CopilotReceiptRecoveryRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      request,
      {
        ...this.scope,
        recoveryReviewed: true,
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
