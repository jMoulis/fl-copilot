import type { CopilotActivity } from "@fl-copilot/sync-contracts";
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
  private listeners = new Map<string, (text: string) => void>();
  subscribe(conversationId: string, listener: (text: string) => void) {
    this.listeners.set(conversationId, listener);
    return () => {
      if (this.listeners.get(conversationId) === listener)
        this.listeners.delete(conversationId);
    };
  }
  private activityListeners = new Map<
    string,
    (activity: CopilotActivity | null) => void
  >();
  subscribeActivities(
    conversationId: string,
    listener: (activity: CopilotActivity | null) => void,
  ) {
    this.activityListeners.set(conversationId, listener);
    return () => {
      if (this.activityListeners.get(conversationId) === listener)
        this.activityListeners.delete(conversationId);
    };
  }
  private aborts = new Map<string, AbortController>();
  cancel(conversationId: string) {
    this.aborts.get(conversationId)?.abort();
  }
  constructor(
    private readonly db: OutboxDatabase & AtomicMutationDatabase,
    private readonly scope: { storeId: string; ownerId: string },
    private readonly dependencies: {
      sync(): Promise<unknown>;
      ask(
        request: CopilotTurnRequest,
        signal: AbortSignal,
        onProgress: (text: string) => void,
        onActivity: (activity: CopilotActivity) => void,
      ): Promise<unknown>;
    },
  ) {}
  deliver(conversationId: string) {
    const existing = this.running.get(conversationId);
    if (existing) return existing;
    const abort = new AbortController();
    this.aborts.set(conversationId, abort);
    const work = this.drain(conversationId, abort.signal);
    this.running.set(conversationId, work);
    void work
      .finally(() => {
        if (this.running.get(conversationId) === work)
          this.running.delete(conversationId);
        if (this.aborts.get(conversationId) === abort)
          this.aborts.delete(conversationId);
      })
      .catch(() => undefined);
    return work;
  }
  /** Bounded sequential batch: stop at the first unsynchronized parent or failure. */
  private async drain(
    conversationId: string,
    signal: AbortSignal,
  ): Promise<"NONE" | "WAITING" | "RECEIVED"> {
    let received = false;
    for (let index = 0; index < 5; index++) {
      cancelled(signal);
      const result = await this.perform(conversationId, signal);
      if (result === "WAITING") return "WAITING";
      if (result === "NONE") return received ? "RECEIVED" : "NONE";
      received = true;
    }
    return "RECEIVED";
  }
  private async perform(
    conversationId: string,
    signal: AbortSignal,
  ): Promise<"NONE" | "WAITING" | "RECEIVED"> {
    const repo = new CopilotConversationRepository(this.db, this.scope);
    const conversation = await repo.get(conversationId);
    if (!conversation || conversation.status !== "ACTIVE")
      throw new Error("COPILOT_CONVERSATION_UNAVAILABLE");
    const pending = await repo.pendingTurns(conversationId);
    if (!pending.length) return "NONE";
    const request = copilotTurnRequestSchema.parse(pending[0]);
    cancelled(signal);
    await this.dependencies.sync();
    cancelled(signal);
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
    cancelled(signal);
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
    cancelled(signal);
    this.listeners.get(conversationId)?.("");
    this.activityListeners.get(conversationId)?.(null);
    let result: unknown;
    try {
      result = await this.dependencies.ask(
        request,
        signal,
        (text) => {
          if (!signal.aborted) this.listeners.get(conversationId)?.(text);
        },
        (activity) => {
          if (!signal.aborted)
            this.activityListeners.get(conversationId)?.(activity);
        },
      );
    } catch (error) {
      this.listeners.get(conversationId)?.("");
      this.activityListeners.get(conversationId)?.(null);
      throw error;
    }
    cancelled(signal);
    const message = await receiveCopilotReply(
      this.db,
      this.scope,
      request,
      result,
    );
    this.listeners.get(conversationId)?.(message.text);
    cancelled(signal);
    try {
      await this.dependencies.sync();
    } catch {
      // The reply is already durable locally; the shared sync service owns its retry state.
      cancelled(signal);
    }
    cancelled(signal);
    return "RECEIVED";
  }
}

function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error("COPILOT_DELIVERY_CANCELLED");
}
