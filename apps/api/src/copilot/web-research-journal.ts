import { createHash, randomUUID } from "node:crypto";
import { MongoServerError, type Db } from "mongodb";
import { z } from "zod";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  publicWebResearchRequestSchema,
  copilotPublicResearchInputSchema,
  publicWebResearchResultSchema,
  type PublicWebResearchResult,
  type CopilotConversation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { CopilotResearchError } from "./web-research.js";

const inputSchema = copilotPublicResearchInputSchema;
const turnSchema = z.strictObject({
  conversationId: z.uuid(),
  userMessageId: z.uuid(),
});
type Journal = {
  _id: string;
  storeId: string;
  ownerId: string;
  conversationId: string;
  parentHash: string;
  query: string;
  purpose: string;
  token: string;
  state: "RUNNING" | "COMPLETE" | "FAILED";
  startedAt: Date;
  finishedAt?: Date;
  result: PublicWebResearchResult | null;
};
export class CopilotResearchJournalError extends Error {
  constructor(
    readonly code:
      | "ACCESS_INVALID"
      | "PARENT_INVALID"
      | "REQUEST_CONFLICT"
      | "IN_PROGRESS"
      | "UNAVAILABLE"
      | "CANCELLED",
  ) {
    super(code);
  }
}
/** Internal seam, not a public route or a model-selected authority.
 * Reserve before calling a paid provider. Uncertain/failed calls never auto-retry.
 * One immutable public query per canonical USER message, including across restarts.
 */
export function createCopilotWebResearchJournal(dependencies: {
  db: Db;
  authorize: () => Promise<{
    storeId: string;
    ownerId: string;
    canRespond: boolean;
  }>;
  research: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<PublicWebResearchResult>;
  now?: () => Date;
}) {
  const { db, authorize, research } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const journal = db.collection<Journal>("copilotWebResearch");
  return async (rawTurn: unknown, rawInput: unknown, signal?: AbortSignal) => {
    const turn = turnSchema.parse(rawTurn);
    const input = inputSchema.parse(rawInput);
    const cancelled = () => {
      if (signal?.aborted) throw new CopilotResearchJournalError("CANCELLED");
    };
    cancelled();
    const authority = await authorize();
    const scope = { storeId: authority.storeId, ownerId: authority.ownerId };
    const check = async () => {
      const renewed = await authorize();
      if (
        !renewed.canRespond ||
        renewed.storeId !== scope.storeId ||
        renewed.ownerId !== scope.ownerId
      )
        throw new CopilotResearchJournalError("ACCESS_INVALID");
      const conversation = await db
        .collection<CopilotConversation & { _id: string }>(
          "copilotConversations",
        )
        .findOne(
          {
            _id: turn.conversationId,
            ...scope,
          },
          { maxTimeMS: 2000 },
        );
      const row = await db
        .collection<CopilotMessage & { _id: string }>("copilotMessages")
        .findOne(
          {
            _id: turn.userMessageId,
            conversationId: turn.conversationId,
            ...scope,
          },
          { maxTimeMS: 2000 },
        );
      if (!conversation || !row)
        throw new CopilotResearchJournalError("PARENT_INVALID");
      const { _id: conversationKey, ...conversationPayload } = conversation;
      const { _id: parentKey, ...parentPayload } = row;
      const convo = copilotConversationSchema.parse(conversationPayload);
      const parent = copilotMessageSchema.parse(parentPayload);
      if (
        convo.id !== conversationKey ||
        convo.status !== "ACTIVE" ||
        parent.id !== parentKey ||
        parent.role !== "USER" ||
        parent.storeId !== scope.storeId ||
        parent.ownerId !== scope.ownerId ||
        parent.conversationId !== convo.id
      )
        throw new CopilotResearchJournalError("PARENT_INVALID");
      const correction = await db
        .collection<CopilotMessage & { _id: string }>("copilotMessages")
        .findOne(
          {
            ...scope,
            conversationId: convo.id,
            role: "USER",
            supersedesMessageId: parent.id,
          },
          { projection: { _id: 1 }, maxTimeMS: 2000 },
        );
      if (correction) throw new CopilotResearchJournalError("PARENT_INVALID");
      return createHash("sha256").update(JSON.stringify(parent)).digest("hex");
    };
    if (!authority.canRespond)
      throw new CopilotResearchJournalError("ACCESS_INVALID");
    const parentHash = await check();
    cancelled();
    const request = publicWebResearchRequestSchema.parse({
      ...input,
      requestId: turn.userMessageId,
    });
    const entry: Journal = {
      _id: turn.userMessageId,
      ...scope,
      conversationId: turn.conversationId,
      parentHash,
      ...input,
      token: randomUUID(),
      state: "RUNNING",
      startedAt: now(),
      result: null,
    };
    const validateResult = (raw: unknown) => {
      const result = publicWebResearchResultSchema.parse(raw);
      if (
        result.requestId !== request.requestId ||
        result.query !== input.query ||
        result.purpose !== input.purpose
      )
        throw new CopilotResearchJournalError("UNAVAILABLE");
      return result;
    };
    try {
      // Majority acknowledgment precedes the paid side effect, even without a transaction.
      await journal.insertOne(entry, { writeConcern: { w: "majority" } });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000)
        throw new CopilotResearchJournalError("UNAVAILABLE");
      const cached = await journal.findOne(
        { _id: entry._id, ...scope, conversationId: turn.conversationId },
        { maxTimeMS: 2000 },
      );
      if (
        !cached ||
        cached.parentHash !== parentHash ||
        cached.query !== input.query ||
        cached.purpose !== input.purpose
      )
        throw new CopilotResearchJournalError("REQUEST_CONFLICT");
      if (cached.state !== "COMPLETE")
        throw new CopilotResearchJournalError(
          cached.state === "RUNNING" ? "IN_PROGRESS" : "UNAVAILABLE",
        );
      const result = validateResult(cached.result);
      if ((await check()) !== parentHash)
        throw new CopilotResearchJournalError("PARENT_INVALID");
      cancelled();
      return result;
    }
    let result: PublicWebResearchResult;
    try {
      if ((await check()) !== parentHash)
        throw new CopilotResearchJournalError("PARENT_INVALID");
      cancelled();
      result = validateResult(await research(request, signal));
    } catch (error) {
      // A failed or cancelled transport may already have incurred cost. Never reclaim it.
      await journal
        .updateOne(
          { _id: entry._id, token: entry.token, state: "RUNNING" },
          {
            $set: { state: "FAILED", finishedAt: now() },
          },
          { writeConcern: { w: "majority" } },
        )
        .catch(() => undefined);
      if (error instanceof CopilotResearchJournalError) throw error;
      if (error instanceof CopilotResearchError && error.code === "CANCELLED")
        throw new CopilotResearchJournalError("CANCELLED");
      throw new CopilotResearchJournalError("UNAVAILABLE");
    }
    // Persist success before checking a late disconnect/revocation. A retry can reuse it.
    const saved = await journal
      .updateOne(
        { _id: entry._id, token: entry.token, state: "RUNNING" },
        {
          $set: { state: "COMPLETE", result, finishedAt: now() },
        },
        { writeConcern: { w: "majority" } },
      )
      .catch(() => {
        throw new CopilotResearchJournalError("UNAVAILABLE");
      });
    if (saved.modifiedCount !== 1)
      throw new CopilotResearchJournalError("UNAVAILABLE");
    if ((await check()) !== parentHash)
      throw new CopilotResearchJournalError("PARENT_INVALID");
    cancelled();
    return result;
  };
}
