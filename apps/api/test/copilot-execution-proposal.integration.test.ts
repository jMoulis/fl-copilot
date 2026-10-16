import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { commercialExecutionFixture } from "../../../scripts/test-commercial-execution-fixtures";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import {
  readCommercialExecutionPreview,
  readCommercialPlan,
} from "../src/copilot/commercial-plan-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import { runMongoMigrations } from "../src/database/migrations";
import { readCopilotExecutionProposal } from "@fl-copilot/domain";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("commercial execution chat proposals", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_exec_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
    await runMongoMigrations(db);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  async function fixture() {
    const f = await commercialExecutionFixture();
    await db
      .collection<Document & { _id: string }>("commercialWeekPlans")
      .insertOne({ _id: f.plan.id, ...f.plan });
    return {
      ...f,
      input: {
        weekStart: f.plan.weekStart,
        taskId: f.proposals[0]!.id,
        status: "DONE" as const,
        note: "Affiche imprimée",
      },
    };
  }
  it("prepares exact current task/revision without recording execution, preserves plan reads and refuses foreign/old tasks", async () => {
    const f = await fixture();
    const result = await readCommercialExecutionPreview(db, f.storeId, f.input);
    expect(result).toMatchObject({
      status: "READY",
      preview: { proposal: f.proposals[0], before: null },
    });
    expect(
      await db
        .collection("commercialExecutionTasks")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
    const read = await readCommercialPlan(db, f.storeId, {
      weekStart: f.plan.weekStart,
      offset: 0,
      limit: 10,
    });
    expect(read.tasks[0]!.proposal).toEqual(result.preview!.proposal);
    expect(read.progress).toMatchObject({ TODO: 2, DONE: 0 });
    expect(
      (await readCommercialExecutionPreview(db, randomUUID(), f.input)).status,
    ).toBe("NO_PLAN");
    expect(
      (
        await readCommercialExecutionPreview(db, f.storeId, {
          ...f.input,
          taskId: randomUUID(),
        })
      ).status,
    ).toBe("TASK_UNAVAILABLE");
    await db
      .collection<Document & { _id: string }>("commercialWeekPlans")
      .deleteOne({ _id: f.plan.id });
    const replacement = await fixture();
    expect(
      (
        await readCommercialExecutionPreview(db, replacement.storeId, {
          ...replacement.input,
          taskId: f.input.taskId,
        })
      ).status,
    ).toBe("TASK_UNAVAILABLE");
  });
  it("preserves the exact existing declaration and suppresses unchanged or drifted target states", async () => {
    const f = await fixture();
    await db
      .collection<Document & { _id: string }>("commercialExecutionTasks")
      .insertOne({ _id: f.task.id, ...f.task });
    const changed = await readCommercialExecutionPreview(
      db,
      f.storeId,
      f.input,
    );
    expect(changed.preview!.before).toEqual(f.task);
    expect(
      (
        await readCommercialExecutionPreview(db, f.storeId, {
          ...f.input,
          note: f.task.note,
        })
      ).status,
    ).toBe("UNCHANGED");
    await db
      .collection<Document & { _id: string }>("commercialExecutionTasks")
      .updateOne({ _id: f.task.id }, { $set: { label: "Drifted target" } });
    const drifted = await readCommercialExecutionPreview(
      db,
      f.storeId,
      f.input,
    );
    expect(drifted.status).toBe("TASK_UNAVAILABLE");
    expect(drifted.preview).toBeNull();
  });
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "commits one private execution card with the reply and replays it after restart without a business declaration",
    async () => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      chat.message.text = "J’ai imprimé cette affiche.";
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await readCommercialExecutionPreview(
        db,
        f.storeId,
        f.input,
      );
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Déclaration préparée, à confirmer.",
          facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-execution",
          inputTokens: null,
          outputTokens: null,
        },
        toolEvidence: preview.evidence,
        executionPreviews: [preview],
      }));
      const dependencies = {
        db,
        provider: { model: "test", generate } as CopilotAiProvider,
        authorize: async () => ({
          storeId: f.storeId,
          ownerId: chat.ownerId,
          canRespond: true,
        }),
        loadContext: async () =>
          detectCopilotConflicts({
            batch: scoreCopilotPriorities({
              storeId: f.storeId,
              evaluatedAt: chat.message.createdAt,
              candidates: [],
            }),
            intents: [],
          }),
      };
      const turn = {
        conversationId: chat.conversation.id,
        userMessageId: chat.message.id,
        replyId: randomUUID(),
      };
      await runCopilotTurn(dependencies, turn);
      const cards = await db
        .collection("copilotMessages")
        .find({ conversationId: chat.conversation.id, role: "TOOL" })
        .toArray();
      expect(cards).toHaveLength(1);
      const { _id, ...payload } = cards[0]!;
      expect(readCopilotExecutionProposal(payload).content.proposal.id).toBe(
        f.input.taskId,
      );
      expect(
        await db.collection("syncChanges").countDocuments({ entityId: _id }),
      ).toBe(1);
      expect((await runCopilotTurn(dependencies, turn)).alreadyApplied).toBe(
        true,
      );
      expect(generate).toHaveBeenCalledOnce();
      expect(
        await db
          .collection("commercialExecutionTasks")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    },
  );
  it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
    "rolls back reply and private artifacts when an execution preview has forged scope",
    async () => {
      const f = await fixture(),
        chat = chatFixture(randomUUID);
      chat.storeId = f.storeId;
      chat.conversation.storeId = f.storeId;
      chat.message.storeId = f.storeId;
      chat.message.attachments = [];
      await db
        .collection<Document & { _id: string }>("copilotConversations")
        .insertOne({ _id: chat.conversation.id, ...chat.conversation });
      await db
        .collection<Document & { _id: string }>("copilotMessages")
        .insertOne({ _id: chat.message.id, ...chat.message });
      const preview = await readCommercialExecutionPreview(
        db,
        f.storeId,
        f.input,
      );
      const generate = vi.fn(async () => ({
        output: {
          language: "fr-FR",
          summary: "Déclaration préparée.",
          facts: [],
          interpretation: [],
          recommendations: [],
          questions: [],
        },
        metadata: {
          requestedModel: "test",
          resolvedModel: "test",
          responseId: "test-rollback",
          inputTokens: null,
          outputTokens: null,
        },
        executionPreviews: [
          {
            ...preview,
            preview: {
              ...preview.preview!,
              proposal: { ...preview.preview!.proposal, storeId: randomUUID() },
            },
          },
        ],
      }));
      const replyId = randomUUID();
      await expect(
        runCopilotTurn(
          {
            db,
            provider: { model: "test", generate } as CopilotAiProvider,
            authorize: async () => ({
              storeId: f.storeId,
              ownerId: chat.ownerId,
              canRespond: true,
            }),
            loadContext: async () =>
              detectCopilotConflicts({
                batch: scoreCopilotPriorities({
                  storeId: f.storeId,
                  evaluatedAt: chat.message.createdAt,
                  candidates: [],
                }),
                intents: [],
              }),
          },
          {
            conversationId: chat.conversation.id,
            userMessageId: chat.message.id,
            replyId,
          },
        ),
      ).rejects.toThrow("SCOPE_INVALID");
      expect(
        await db.collection("copilotMessages").countDocuments({
          conversationId: chat.conversation.id,
          role: { $in: ["ASSISTANT", "TOOL"] },
        }),
      ).toBe(0);
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ entityId: replyId }),
      ).toBe(0);
    },
  );
});
