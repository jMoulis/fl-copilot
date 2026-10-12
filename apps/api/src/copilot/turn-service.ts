import { readConversationGenerationHistory } from "./generation-history.js";
import { readLatestDepartmentEvidence } from "./daily-evidence.js";
import { acquireTurnLease } from "./turn-lease.js";
import { randomUUID } from "node:crypto";
import {
  copilotTurnRequestSchema,
  type CopilotTurnRequest,
  copilotConversationSchema,
  copilotMessageSchema,
  type CopilotConversation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { Db } from "mongodb";
import type {
  CopilotAiProvider,
  CopilotGenerationRequest,
} from "./ai-provider.js";
import { generateCopilotResponse } from "./response-service.js";
import { buildCopilotResponseMessage } from "./response-message.js";
import { appendCopilotResponse } from "./response-store.js";
import { createMongoSyncChangeService } from "../sync/sync-change-service.js";

export class CopilotTurnError extends Error {
  constructor(
    readonly code:
      "ACCESS_INVALID" | "PARENT_INVALID" | "IDENTITY_CONFLICT" | "CANCELLED",
  ) {
    super(code);
    this.name = "CopilotTurnError";
  }
}
/** Internal orchestration; authenticated application supplies authority and trusted context loader. */
export async function runCopilotTurn(
  dependencies: {
    db: Db;
    provider: CopilotAiProvider;
    authorize: () => Promise<{
      storeId: string;
      ownerId: string;
      canRespond: boolean;
    }>;
    loadContext: (
      parent: CopilotMessage,
    ) => Promise<CopilotGenerationRequest["context"]>;
    now?: () => Date;
  },
  raw: CopilotTurnRequest,
  signal?: AbortSignal,
): Promise<{ message: CopilotMessage; alreadyApplied: boolean }> {
  const input = copilotTurnRequestSchema.parse(raw);
  const cancelled = () => {
    if (signal?.aborted) throw new CopilotTurnError("CANCELLED");
  };
  cancelled();
  const authority = await dependencies.authorize();
  if (!authority.canRespond) throw new CopilotTurnError("ACCESS_INVALID");
  const read = async () => {
    const scope = { storeId: authority.storeId, ownerId: authority.ownerId };
    const conversation = await dependencies.db
      .collection<CopilotConversation & { _id: string }>("copilotConversations")
      .findOne({ _id: input.conversationId, ...scope });
    if (!conversation) throw new CopilotTurnError("PARENT_INVALID");
    const { _id, ...payload } = conversation;
    void _id;
    if (copilotConversationSchema.parse(payload).status !== "ACTIVE")
      throw new CopilotTurnError("PARENT_INVALID");
    const row = await dependencies.db
      .collection<CopilotMessage & { _id: string }>("copilotMessages")
      .findOne({
        _id: input.userMessageId,
        conversationId: input.conversationId,
        ...scope,
      });
    if (!row) throw new CopilotTurnError("PARENT_INVALID");
    const { _id: parentKey, ...parentPayload } = row;
    void parentKey;
    const parent = copilotMessageSchema.parse(parentPayload);
    if (parent.role !== "USER") throw new CopilotTurnError("PARENT_INVALID");
    const cached = await dependencies.db
      .collection<CopilotMessage & { _id: string }>("copilotMessages")
      .findOne({ _id: input.replyId });
    if (cached) {
      const { _id: key, ...data } = cached;
      void key;
      const message = copilotMessageSchema.parse(data);
      if (
        message.storeId !== authority.storeId ||
        message.ownerId !== authority.ownerId ||
        message.conversationId !== input.conversationId ||
        message.replyToMessageId !== input.userMessageId ||
        message.role !== "ASSISTANT"
      )
        throw new CopilotTurnError("IDENTITY_CONFLICT");
      return { parent, cached: message };
    }
    return { parent, cached: null };
  };
  const initial = await read();
  cancelled();
  if (initial.cached) return { message: initial.cached, alreadyApplied: true };
  const lease = await acquireTurnLease(dependencies.db, {
    ...input,
    storeId: authority.storeId,
    ownerId: authority.ownerId,
  });
  try {
    const afterLease = await read();
    cancelled();
    if (afterLease.cached)
      return { message: afterLease.cached, alreadyApplied: true };
    const context = await dependencies.loadContext(initial.parent);
    cancelled();
    const evidence = await readLatestDepartmentEvidence(
      dependencies.db,
      authority.storeId,
    );
    cancelled();
    const history = await readConversationGenerationHistory(
      dependencies.db,
      initial.parent,
    );
    cancelled();
    const request = {
      requestId: randomUUID(),
      storeId: authority.storeId,
      context,
      evidence,
      history,
      userQuestion: initial.parent.text || null,
    };
    const generation = await generateCopilotResponse(
      dependencies.provider,
      request,
      signal,
    );
    cancelled();
    const renewed = await dependencies.authorize();
    if (
      !renewed.canRespond ||
      renewed.storeId !== authority.storeId ||
      renewed.ownerId !== authority.ownerId
    )
      throw new CopilotTurnError("ACCESS_INVALID");
    const latest = await read();
    cancelled();
    if (latest.cached) return { message: latest.cached, alreadyApplied: true };
    const message = buildCopilotResponseMessage({
      id: input.replyId,
      createdAt: (dependencies.now?.() ?? new Date()).toISOString(),
      parent: latest.parent,
      request,
      generation,
    });
    const session = dependencies.db.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        cancelled();
        await lease.fence(session);
        return appendCopilotResponse(
          { database: dependencies.db, session },
          renewed,
          message,
          createMongoSyncChangeService(),
        );
      });
      if (!result) throw new Error("COPILOT_REPLY_COMMIT_FAILED");
      return result;
    } finally {
      await session.endSession();
    }
  } finally {
    await lease.release();
  }
}
