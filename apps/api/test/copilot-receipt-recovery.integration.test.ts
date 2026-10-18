import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  copilotMessageSchema,
  readReceiptRecoveryProposal,
} from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import {
  receiptRecoveryFixture,
  nativeReceiptRecoveryFixture,
} from "../../../scripts/test-receipt-recovery-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { previewReceiptRecovery } from "../src/copilot/receipt-recovery-tool";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import { applyCopilotRecord } from "../../mobile/src/copilot/conversation-repository";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "receipt recovery with disposable Atlas and SQLite",
  () => {
    let client: MongoClient, db: Db;
    const collection = (name: string) =>
      db.collection<Document & { _id: string }>(name);
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_receipt_recover_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      );
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    });
    async function register(f: ReturnType<typeof receiptRecoveryFixture>) {
      await collection("sourceDocuments").insertOne({
        _id: f.source.sourceDocumentId,
        storeId: f.chat.storeId,
        sourceType: "WASTE_RECEIPT",
        originalFilename: f.source.filename,
        checksum: f.source.checksum,
        createdAt: new Date(f.p.source.createdAt),
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      });
    }
    it.each(["RETRY_PROCESSING", "KEEP_BOTH", "CONFIRM_DUPLICATE"] as const)(
      "prepares %s without starting jobs, extraction or publication",
      async (action) => {
        const f = receiptRecoveryFixture(action);
        await register(f);
        expect(
          await previewReceiptRecovery(db, f.chat.storeId, f.input),
        ).toMatchObject({
          input: f.input,
          source: f.source,
          status: "REVIEW_LOCAL",
        });
        for (const name of [
          "wasteReceiptPublications",
          "wasteObservations",
          "syncChanges",
          "backgroundJobs",
        ])
          expect(
            await collection(name).countDocuments({ storeId: f.chat.storeId }),
          ).toBe(0);
      },
    );
    it.each(["FOREIGN", "DELETED", "UNCONFIRMED", "WRONG_TYPE"])(
      "rejects an unavailable original (%s)",
      async (mode) => {
        const f = receiptRecoveryFixture();
        await register(f);
        if (mode !== "FOREIGN")
          await collection("sourceDocuments").updateOne(
            { _id: f.source.sourceDocumentId },
            {
              $set:
                mode === "DELETED"
                  ? { deletedAt: new Date() }
                  : mode === "UNCONFIRMED"
                    ? { remoteUploadStatus: "PENDING" }
                    : { sourceType: "MERCALYS_WASTE" },
            },
          );
        await expect(
          previewReceiptRecovery(
            db,
            mode === "FOREIGN" ? randomUUID() : f.chat.storeId,
            f.input,
          ),
        ).rejects.toThrow("UNAVAILABLE");
      },
    );
    it("makes an already published source read-only even when receipt and source IDs differ", async () => {
      const f = receiptRecoveryFixture();
      await register(f);
      await collection("wasteReceiptPublications").insertOne({
        _id: f.p.receipt.id,
        storeId: f.chat.storeId,
        publication: { source: { id: f.source.sourceDocumentId } },
      });
      expect(
        (await previewReceiptRecovery(db, f.chat.storeId, f.input)).status,
      ).toBe("READ_ONLY");
    });
    it
      .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
      .each(["AI", "FALLBACK", "FOREIGN"])(
      "atomically saves the checked card, replays once and runs the canonical local retry (%s)",
      async (mode) => {
        const native = await nativeReceiptRecoveryFixture();
        const f = native.f,
          chat = f.chat;
        try {
          await register({
            ...f,
            input: native.recovery.input,
            preview: native.recovery.preview,
          });
          await collection("copilotConversations").insertOne({
            _id: chat.conversation.id,
            ...chat.conversation,
          });
          await collection("copilotMessages").insertOne({
            _id: chat.message.id,
            ...chat.message,
          });
          const preview = await previewReceiptRecovery(
            db,
            chat.storeId,
            native.recovery.input,
          );
          if (mode === "FOREIGN") preview.source.storeId = randomUUID();
          const generate = vi.fn(async () => ({
            output: {
              language: "fr-FR" as const,
              summary: "La reprise du ticket est préparée, sans publication.",
              facts: [
                {
                  evidenceId:
                    mode === "FALLBACK"
                      ? "unknown-evidence"
                      : preview.evidence[0]!.id,
                },
              ],
              interpretation: [],
              recommendations: [],
              questions: [],
            },
            metadata: {
              requestedModel: "test",
              resolvedModel: "test",
              responseId: "test",
              inputTokens: null,
              outputTokens: null,
            },
            toolEvidence: preview.evidence,
            receiptRecoveryPreviews: [preview],
          }));
          const deps = {
            db,
            provider: { model: "test", generate } as CopilotAiProvider,
            authorize: async () => ({
              storeId: chat.storeId,
              ownerId: chat.ownerId,
              canRespond: true,
            }),
            loadContext: async () =>
              detectCopilotConflicts({
                batch: scoreCopilotPriorities({
                  storeId: chat.storeId,
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
          if (mode === "FOREIGN") {
            await expect(runCopilotTurn(deps, turn)).rejects.toThrow();
            expect(
              await collection("copilotMessages").countDocuments({
                conversationId: chat.conversation.id,
                role: { $in: ["ASSISTANT", "TOOL"] },
              }),
            ).toBe(0);
            return;
          }
          await runCopilotTurn(deps, turn);
          const records = await collection("copilotMessages")
            .find({
              conversationId: chat.conversation.id,
              role: { $in: ["ASSISTANT", "TOOL"] },
            })
            .toArray();
          expect(records).toHaveLength(2);
          const messages = records.map(({ _id, ...record }) => {
            void _id;
            return copilotMessageSchema.parse(record);
          });
          const card = messages.find((m) => m.role === "TOOL")!;
          expect(readReceiptRecoveryProposal(card).content.source).toEqual(
            f.source,
          );
          await native.a.withExclusiveTransactionAsync(async (tx) => {
            for (const message of messages)
              await applyCopilotRecord(tx, chat, "copilot_message", message);
          });
          const state = await native.recovery.controller.open(card);
          expect(state.status).toBe("READY");
          expect(
            (
              await native.recovery.controller.confirm(
                card,
                state.review!.basisHash,
                true,
              )
            ).status,
          ).toBe("COMPLETED");
          expect((await native.recovery.controller.open(card)).status).toBe(
            "COMPLETED",
          );
          expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
          expect(generate).toHaveBeenCalledOnce();
          for (const name of ["wasteReceiptPublications", "wasteObservations"])
            expect(
              await collection(name).countDocuments({ storeId: chat.storeId }),
            ).toBe(0);
        } finally {
          native.db.close();
        }
      },
    );
  },
);
