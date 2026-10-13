import {
  copilotTurnRequestSchema,
  copilotMessageSchema,
  type CopilotTurnRequest,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { CopilotConversationRepository } from "./conversation-repository";
import { receiveCopilotReply } from "./response-receiver";

/** One in-flight delivery per conversation and instance; persisted request IDs survive instance/app restart. */
export class CopilotTurnDelivery {
  private running = new Map<string, Promise<"NONE" | "WAITING" | "RECEIVED">>();
  constructor(
    private readonly db: OutboxDatabase & AtomicMutationDatabase,
    private readonly scope: { storeId: string; ownerId: string },
    private readonly dependencies: {
      sync(): Promise<unknown>;
      ask(request: CopilotTurnRequest): Promise<unknown>;
    },
  ) {}
  deliver(conversationId: string) {
    const existing = this.running.get(conversationId);
    if (existing) return existing;
    const work = this.drain(conversationId);
    this.running.set(conversationId, work);
    void work
      .finally(() => {
        if (this.running.get(conversationId) === work)
          this.running.delete(conversationId);
      })
      .catch(() => undefined);
    return work;
  }
  /** Bounded sequential batch: stop at the first unsynchronized parent or failure. */
  private async drain(
    conversationId: string,
  ): Promise<"NONE" | "WAITING" | "RECEIVED"> {
    let received = false;
    for (let index = 0; index < 5; index++) {
      const result = await this.perform(conversationId);
      if (result === "WAITING") return "WAITING";
      if (result === "NONE") return received ? "RECEIVED" : "NONE";
      received = true;
    }
    return "RECEIVED";
  }
  private async perform(
    conversationId: string,
  ): Promise<"NONE" | "WAITING" | "RECEIVED"> {
    const repo = new CopilotConversationRepository(this.db, this.scope);
    const conversation = await repo.get(conversationId);
    if (!conversation || conversation.status !== "ACTIVE")
      throw new Error("COPILOT_CONVERSATION_UNAVAILABLE");
    const pending = await repo.pendingTurns(conversationId);
    if (!pending.length) return "NONE";
    const request = copilotTurnRequestSchema.parse(pending[0]);
    await this.dependencies.sync();
    const parent = await this.db.getFirstAsync<{
      sync_state: string;
      payload_json: string;
    }>(
      "SELECT sync_state,payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      request.userMessageId,
      this.scope.storeId,
      this.scope.ownerId,
      conversationId,
    );
    if (!parent) throw new Error("COPILOT_REPLY_PARENT_INVALID");
    const user = copilotMessageSchema.parse(JSON.parse(parent.payload_json));
    if (
      user.id !== request.userMessageId ||
      user.storeId !== this.scope.storeId ||
      user.ownerId !== this.scope.ownerId ||
      user.conversationId !== conversationId ||
      user.role !== "USER"
    )
      throw new Error("COPILOT_REPLY_PARENT_INVALID");
    const existing = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      request.replyId,
      this.scope.storeId,
      this.scope.ownerId,
      conversationId,
    );
    if (existing) {
      await receiveCopilotReply(this.db, this.scope, request, {
        message: copilotMessageSchema.parse(JSON.parse(existing.payload_json)),
        alreadyApplied: true,
      });
      return "RECEIVED";
    }
    if (parent.sync_state !== "SYNCED") return "WAITING";
    const current = await repo.get(conversationId);
    if (!current || current.status !== "ACTIVE")
      throw new Error("COPILOT_CONVERSATION_UNAVAILABLE");
    const result = await this.dependencies.ask(request);
    await receiveCopilotReply(this.db, this.scope, request, result);
    return "RECEIVED";
  }
}
