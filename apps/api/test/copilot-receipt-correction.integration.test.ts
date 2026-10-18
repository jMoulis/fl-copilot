import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { receiptCorrectionFixture } from "../../../scripts/test-receipt-correction-fixtures";
import { nativeReceiptCorrectionFixture } from "../../../scripts/test-receipt-correction-sqlite";
import { previewReceiptCorrection } from "../src/copilot/receipt-correction-tool";
import { readReceiptCorrectionProposal } from "@fl-copilot/domain";
import {
  syncCommandSchema,
  synchronizedWastePublicationSchema,
} from "@fl-copilot/sync-contracts";
import { runMongoMigrations } from "../src/database/migrations";
import { applyWastePublicationCommand } from "../src/uploads/waste-receipt-publication";
import { createMongoSyncChangeService } from "../src/sync/sync-change-service";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "receipt correction chat review on disposable Atlas",
  () => {
    let client: MongoClient, db: Db;
    const collection = (name: string) =>
      db.collection<Document & { _id: string }>(name);
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_receipt_fix_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
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
    async function fixture() {
      const f = receiptCorrectionFixture();
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
      return f;
    }
    it("prepares only local review from existing extraction without publication or another paid extraction", async () => {
      const f = await fixture(),
        reader = { read: vi.fn(async () => f.draft) };
      const result = await previewReceiptCorrection(
        db,
        f.chat.storeId,
        f.preview.input,
        reader,
      );
      expect(result).toMatchObject({
        source: f.source,
        status: "REVIEW_LOCAL",
      });
      expect(reader.read).toHaveBeenCalledOnce();
      for (const name of [
        "wasteReceiptPublications",
        "wasteObservations",
        "syncChanges",
      ])
        expect(
          await collection(name).countDocuments({ storeId: f.chat.storeId }),
        ).toBe(0);
      await expect(
        previewReceiptCorrection(db, randomUUID(), f.preview.input, reader),
      ).rejects.toThrow("UNAVAILABLE");
    });
    it.each(["EMPTY", "PENDING", "LIMIT", "WRONG_KIND", "UNCONFIRMED"])(
      "does not create a review that skips source/processing bounds (%s)",
      async (mode) => {
        const f = await fixture();
        const draft = structuredClone(f.draft);
        if (mode === "EMPTY") draft.lines = [];
        if (mode === "LIMIT")
          draft.lines = Array.from({ length: 101 }, (_, n) => ({
            ...draft.lines[0]!,
            lineId: randomUUID(),
            sourceLineIndex: n,
          }));
        if (mode === "WRONG_KIND")
          await collection("sourceDocuments").updateOne(
            { _id: f.source.sourceDocumentId },
            { $set: { sourceType: "MERCALYS_WASTE" } },
          );
        if (mode === "UNCONFIRMED")
          await collection("sourceDocuments").updateOne(
            { _id: f.source.sourceDocumentId },
            { $set: { remoteUploadStatus: "PENDING" } },
          );
        const reader = {
          read: async () => {
            if (mode === "PENDING")
              throw Error("WASTE_RECEIPT_DRAFT_NOT_READY");
            return draft;
          },
        };
        if (["WRONG_KIND", "UNCONFIRMED"].includes(mode))
          await expect(
            previewReceiptCorrection(
              db,
              f.chat.storeId,
              f.preview.input,
              reader,
            ),
          ).rejects.toThrow("UNAVAILABLE");
        else
          expect(
            (
              await previewReceiptCorrection(
                db,
                f.chat.storeId,
                f.preview.input,
                reader,
              )
            ).status,
          ).toBe(mode === "LIMIT" ? "LIMIT_EXCEEDED" : "NOT_READY");
      },
    );
    it.skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
      "syncs chat-corrected local facts through the separate canonical publication once, then makes correction read-only",
      async () => {
        const f = await fixture(),
          native = await nativeReceiptCorrectionFixture(":memory:", f),
          session = client.startSession();
        try {
          // Apply the actual chat correction before the separate native publication.
          await native.correctionController.confirm(
            native.correctionMessage,
            native.correctionRequest.basisHash,
            true,
          );
          await native.repo.confirmCashierNumber(f.p.receipt.id, "000123");
          await native.repo.confirmWasteDate(f.p.receipt.id, "2026-10-10");
          const state = await native.controller.open(native.message);
          await native.controller.confirm(
            native.message,
            state.review!.basisHash,
            true,
          );
          const row = await native.a.getFirstAsync<{
            command_id: string;
            local_sequence: number;
            entity_id: string;
            payload_json: string;
            created_at: string;
          }>(
            "SELECT * FROM sync_outbox WHERE command_type='WASTE_RECEIPT_PUBLISH'",
          );
          const command = syncCommandSchema.parse({
            commandId: row!.command_id,
            localSequence: row!.local_sequence,
            type: "WASTE_RECEIPT_PUBLISH",
            entityType: "waste_receipt_publication",
            entityId: row!.entity_id,
            expectedRemoteVersion: null,
            createdAt: row!.created_at,
            payload: JSON.parse(row!.payload_json),
          });
          await collection("products").insertOne({
            ...native.product,
            _id: native.product.id,
          });
          for (let n = 0; n < 2; n++)
            await session.withTransaction(async () => {
              const r = await applyWastePublicationCommand(
                { database: db, session },
                f.chat.storeId,
                command,
                randomUUID(),
                createMongoSyncChangeService(),
              );
              expect(r.resultStatus).toBe("APPLIED");
            });
          expect(
            await collection("wasteObservations").countDocuments({
              storeId: f.chat.storeId,
            }),
          ).toBe(1);
          const saved = await collection("wasteReceiptPublications").findOne({
            _id: f.p.receipt.id,
          });
          const p = synchronizedWastePublicationSchema.parse(saved).publication;
          expect(p.receipt.confirmedCashierNumber).toBe("000123");
          expect(p.lines[0]).toMatchObject({ weight: "2", totalPrice: "4" });
          expect(p.receipt.confirmedWasteDate).toBe("2026-10-10");
          expect(
            p.lines.filter((l) => l.validationStatus === "EXCLUDED"),
          ).toHaveLength(1);
          expect(
            (
              await previewReceiptCorrection(
                db,
                f.chat.storeId,
                f.preview.input,
                {
                  read: async () => {
                    throw Error("must not read old extraction");
                  },
                },
              )
            ).status,
          ).toBe("READ_ONLY");
          expect(
            await collection("salesObservations").countDocuments({
              storeId: f.chat.storeId,
            }),
          ).toBe(0);
        } finally {
          native.db.close();
          await session.endSession();
        }
      },
    );
    it
      .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
      .each([false, true])(
      "atomically persists a private review card with the reply and replays once (foreign=%s)",
      async (foreign) => {
        const f = await fixture(),
          chat = f.chat;
        await collection("copilotConversations").insertOne({
          _id: chat.conversation.id,
          ...chat.conversation,
        });
        await collection("copilotMessages").insertOne({
          _id: chat.message.id,
          ...chat.message,
        });
        const preview = await previewReceiptCorrection(
          db,
          chat.storeId,
          f.preview.input,
          { read: async () => f.draft },
        );
        if (foreign) preview.source.storeId = randomUUID();
        const generate = vi.fn(async () => ({
          output: {
            language: "fr-FR",
            summary: "La revue du ticket est préparée, sans publication.",
            facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: "test-correction",
            inputTokens: null,
            outputTokens: null,
          },
          toolEvidence: preview.evidence,
          receiptCorrectionPreviews: [preview],
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
          },
          turn = {
            conversationId: chat.conversation.id,
            userMessageId: chat.message.id,
            replyId: randomUUID(),
          };
        if (foreign) {
          await expect(runCopilotTurn(deps, turn)).rejects.toThrow();
          expect(
            await collection("copilotMessages").countDocuments({
              conversationId: chat.conversation.id,
              role: { $in: ["ASSISTANT", "TOOL"] },
            }),
          ).toBe(0);
        } else {
          await runCopilotTurn(deps, turn);
          const cards = await collection("copilotMessages")
            .find({ conversationId: chat.conversation.id, role: "TOOL" })
            .toArray();
          expect(cards).toHaveLength(1);
          const { _id, ...card } = cards[0]!;
          void _id;
          expect(readReceiptCorrectionProposal(card).content.source).toEqual(
            f.source,
          );
          expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
          expect(generate).toHaveBeenCalledOnce();
          expect(
            await collection("wasteReceiptPublications").countDocuments({
              storeId: chat.storeId,
            }),
          ).toBe(0);
        }
      },
    );
  },
);
