import {
  readCopilotProductProposal,
  productClassificationIntent,
  productClassificationResultSchema,
  copilotMessageSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { ProductMasterRepository } from "../products/product-master-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { CopilotProductMutationRuntime } from "./product-mutation-runtime";
export class CopilotProductProposalController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canManageProducts: boolean;
    },
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, proposal, preview, items } =
      readCopilotProductProposal(raw);
    if (
      message.storeId !== this.scope.storeId ||
      message.ownerId !== this.scope.ownerId
    )
      throw Error("COPILOT_PROPOSAL_SCOPE_INVALID");
    const persisted = await this.db.getFirstAsync<{
      payload_json: string;
      sync_state: string;
    }>(
      "SELECT payload_json,sync_state FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      message.id,
      message.storeId,
      message.ownerId,
      message.conversationId,
    );
    if (
      !persisted ||
      persisted.sync_state !== "SYNCED" ||
      JSON.stringify(
        copilotMessageSchema.parse(JSON.parse(persisted.payload_json)),
      ) !== JSON.stringify(message)
    )
      throw Error("COPILOT_PROPOSAL_UNAVAILABLE");
    const assistant = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      proposal.assistantMessageId,
      message.storeId,
      message.ownerId,
      message.conversationId,
    );
    const parent = assistant
      ? copilotMessageSchema.parse(JSON.parse(assistant.payload_json))
      : null;
    if (
      !parent ||
      parent.role !== "ASSISTANT" ||
      parent.storeId !== message.storeId ||
      parent.ownerId !== message.ownerId ||
      parent.conversationId !== message.conversationId ||
      parent.id !== proposal.assistantMessageId ||
      parent.replyToMessageId !== message.replyToMessageId
    )
      throw Error("COPILOT_PROPOSAL_PARENT_INVALID");
    const previous = await this.db.getFirstAsync<{
      result_json: string;
      store_id: string;
      owner_id: string;
      conversation_id: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (previous) {
      const result = productClassificationResultSchema.parse(
        JSON.parse(previous.result_json),
      );
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId
      )
        throw Error("COPILOT_PROPOSAL_SCOPE_INVALID");
      return {
        message,
        proposal,
        preview,
        items,
        staleLabels: [] as string[],
        status: "COMPLETED" as const,
      };
    }
    const repo = new ProductMasterRepository(this.db);
    const current = await Promise.all(
      items.map((item) => repo.getProduct(item.before.id)),
    );
    const staleLabels = items
      .filter((item, index) => {
        const product = current[index];
        return (
          !product ||
          product.entity.storeId !== message.storeId ||
          product.entity.deletedAt ||
          product.entity.status === "INACTIVE" ||
          product.entity.version !== item.before.version ||
          product.syncState === "CONFLICT" ||
          product.syncState === "ERROR" ||
          ["category", "nature", "salesUnit"].some(
            (key) =>
              product.entity[key as "category"] !==
              item.before[key as "category"],
          )
        );
      })
      .map((item) => item.before.label);
    return {
      message,
      proposal,
      preview,
      items,
      staleLabels,
      status: staleLabels.length ? ("STALE" as const) : ("READY" as const),
    };
  }
  /** Invoked only by the explicit native confirmation button. */
  async confirm(message: CopilotMessage, signal?: AbortSignal) {
    if (!this.scope.canManageProducts)
      throw Error("COPILOT_PROPOSAL_FORBIDDEN");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY") throw Error("COPILOT_PROPOSAL_STALE");
    const request = {
      operationId: message.id,
      schemaVersion: 1,
      tool: "product.classify",
      input: {
        changes: state.items.map((item) => ({
          productId: item.before.id,
          expectedVersion: item.before.version,
          patch: item.patch,
        })),
        allowOverwriteConfirmed: state.items.some(
          (item) => item.preview.reviewFields.length > 0,
        ),
      },
    };
    await new CopilotProductMutationRuntime(this.db, this.id).execute(
      request,
      {
        storeId: this.scope.storeId,
        ownerId: this.scope.ownerId,
        deviceId: this.scope.deviceId,
        canManageProducts: this.scope.canManageProducts,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: productClassificationIntent(request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
