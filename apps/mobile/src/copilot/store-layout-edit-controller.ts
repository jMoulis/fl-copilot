import {
  readCopilotLayoutEditProposal,
  layoutEditResultSchema,
  ProductClassificationError,
  type CopilotMessage,
  type StoreLayout,
} from "@fl-copilot/domain";
import { prepareStoreLayoutEdit } from "@fl-copilot/commercial-core";
import { StoreLayoutRepository } from "../store/layout-repository";
import { verifyPrivateToolRecord } from "./private-tool-record";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
type Database = OutboxDatabase & AtomicMutationDatabase;
export class CopilotStoreLayoutEditController {
  constructor(
    private db: Database,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canManageStoreLayout: boolean;
    },
    private uuid: () => string,
    private now = () => new Date().toISOString(),
  ) {}
  private async snapshot(
    repo: StoreLayoutRepository,
    head: StoreLayout | null,
  ) {
    return {
      head,
      reference: head?.referenceRevisionId
        ? head.referenceRevisionId === head.revisionId
          ? head
          : await repo.getRevision(this.scope.storeId, head.referenceRevisionId)
        : null,
    };
  }
  private async prepare(
    db: Database,
    content: ReturnType<typeof readCopilotLayoutEditProposal>["content"],
  ) {
    const repo = new StoreLayoutRepository(db, this.uuid, this.now),
      local = await repo.get(this.scope.storeId);
    if (local && ["CONFLICT", "ERROR"].includes(local.syncState))
      throw new ProductClassificationError("SYNC_CONFLICT");
    const review = prepareStoreLayoutEdit(
      this.scope.storeId,
      content.input,
      await this.snapshot(repo, local?.entity ?? null),
      content.created,
    );
    if (
      review.status !== "READY" ||
      JSON.stringify(review.basis) !== JSON.stringify(content.basis) ||
      !review.after ||
      !review.before
    )
      throw new ProductClassificationError("VERSION_CONFLICT");
    return { ...review, after: review.after, before: review.before };
  }
  async open(raw: CopilotMessage) {
    const { message, content } = readCopilotLayoutEditProposal(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const request = {
      operationId: message.id,
      schemaVersion: 1,
      tool: "store.layout.save_draft",
      input: content,
    };
    const old = await this.db.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (old) {
      const result = layoutEditResultSchema.parse(JSON.parse(old.result_json));
      if (
        old.store_id !== this.scope.storeId ||
        old.owner_id !== this.scope.ownerId ||
        old.conversation_id !== message.conversationId ||
        old.request_json !== JSON.stringify(request) ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId
      )
        throw Error("LAYOUT_PROPOSAL_SCOPE");
      return {
        message,
        content,
        request,
        status: "COMPLETED" as const,
        result,
        review: null,
      };
    }
    try {
      const review = await this.prepare(this.db, content);
      return {
        message,
        content,
        request,
        status: "READY" as const,
        review,
        result: null,
      };
    } catch (error) {
      if (!(error instanceof ProductClassificationError)) throw error;
      return {
        message,
        content,
        request,
        status: "STALE" as const,
        review: null,
        result: null,
      };
    }
  }
  async confirm(raw: CopilotMessage, signal?: AbortSignal) {
    if (!this.scope.canManageStoreLayout)
      throw new ProductClassificationError("FORBIDDEN");
    const state = await this.open(raw);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY")
      throw new ProductClassificationError("VERSION_CONFLICT");
    const { canManageStoreLayout, ...scope } = this.scope;
    const authority = {
      ...scope,
      canExecute: canManageStoreLayout,
      conversationId: state.message.conversationId,
      userMessageId: state.message.replyToMessageId!,
      decisionLevel: "REVIEWED" as const,
      authorizedRequestJson: JSON.stringify(state.request),
    };
    await runReviewedStoreOperation(
      this.db,
      state.request,
      authority,
      layoutEditResultSchema,
      async (tx, ctx) => {
        await verifyPrivateToolRecord(
          tx,
          this.scope,
          state.message,
          state.content.assistantMessageId,
        );
        const joined = joinedProductToolDatabase(tx),
          review = await this.prepare(joined, state.content);
        const commandId = this.uuid();
        const after = await new StoreLayoutRepository(
          joined,
          this.uuid,
          this.now,
        ).save(
          {
            storeId: this.scope.storeId,
            expectedRevisionId: state.content.basis.revisionId,
            action: "SAVE_DRAFT",
            content: review.after,
          },
          {
            commandId,
            deviceId: ctx.deviceId,
            actorId: ctx.ownerId,
            canWrite: true,
          },
        );
        return {
          operationId: state.message.id,
          schemaVersion: 1,
          tool: "store.layout.save_draft",
          status: "COMPLETED",
          userMessageId: ctx.userMessageId,
          appliedAt: after.updatedAt,
          revisionId: after.revisionId,
          referenceRevisionId: after.referenceRevisionId,
          commandId,
          syncState: "PENDING",
          message:
            "Brouillon du plan enregistré localement. La référence adoptée reste conservée ; synchronisation en attente.",
        };
      },
      signal,
    );
    return this.open(raw);
  }
}
