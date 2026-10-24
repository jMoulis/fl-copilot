import { vi } from "vitest";
import type { Document } from "mongodb";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { readTranscriptionReviewProposal } from "@fl-copilot/domain";
import { attachTranscriptionChat } from "../../../scripts/test-copilot-transcription-fixtures";
import { previewTranscriptionReview } from "../src/copilot/transcription-review-tool";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  receiptReviewDigest,
  ReceiptTestDatabase,
} from "../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { CommercialReviewRepository } from "../../mobile/src/commercial/review-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../../mobile/src/sync/conflict-repository";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CommercialReviewPage,
  CommercialReviewDecision,
  SyncCommand,
} from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo.js";
import { parseEnvironment } from "../src/config.js";
import type { DatabaseService } from "../src/database/types.js";
import { registerCommercialReviewPages } from "../src/commercial/review-sync.js";
import { createMongoSyncPullService } from "../src/sync/pull-service.js";
import { createMongoSyncPushService } from "../src/sync/push-service.js";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "commercial extraction review sync",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_review_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      await (await database.getDb()).dropDatabase();
      await database.close();
    });
    async function seed() {
      const storeId = randomUUID(),
        sourceDocumentId = randomUUID(),
        pageId = randomUUID();
      const db = await database.getDb();
      const page: CommercialReviewPage = {
        id: pageId,
        storeId,
        sourceDocumentId,
        checksum: "sha256:fixture",
        pageNumber: 1,
        pageCount: 1,
        originalFilename: "week.pdf",
        remoteVersion: 1,
        warnings: [],
        issues: [],
        blocks: [
          {
            kind: "OFFER",
            label: "POIRE",
            sourceBlockIndex: 0,
            validationStatus: "TO_VALIDATE",
            evidence: [
              { pageNumber: 1, spanIndices: [0], quote: "POIRE 2,99 €/kg" },
            ],
            fields: [
              {
                name: "sellingPrice",
                rawValue: "2,99 €/kg",
                confidence: 0.9,
                validationStatus: "TO_VALIDATE",
                evidence: [
                  { pageNumber: 1, spanIndices: [0], quote: "2,99 €/kg" },
                ],
              },
            ],
          },
        ],
      };
      const collection = (name: string) =>
        db.collection<{ _id: string; [key: string]: unknown }>(name);
      await collection("sourceDocuments").insertOne({
        _id: sourceDocumentId,
        storeId,
        originalFilename: page.originalFilename,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        checksum: page.checksum,
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      });
      await collection("commercialDocumentJobs").insertOne({
        _id: sourceDocumentId,
        storeId,
        checksum: page.checksum,
        pageCount: 1,
        status: "TO_VALIDATE",
        stage: "DRAFT_REVIEW",
        parserVersion: "parser",
        aiModel: "model",
        aiSchemaVersion: "schema",
      });
      await collection("commercialDocumentAiPages").insertOne({
        _id: pageId,
        storeId,
        sourceDocumentId,
        pageNumber: 1,
        checksum: page.checksum,
        parserVersion: "parser",
        model: "model",
        schemaVersion: "schema",
        status: "DRAFT_READY",
        draft: { blocks: page.blocks, warnings: [], issues: [] },
      });
      return { storeId, sourceDocumentId, pageId, page };
    }
    it.each([
      "READY",
      "FOREIGN",
      "UNCONFIRMED",
      "DELETED",
      "WRONG_TYPE",
    ] as const)(
      "reads only confirmed same-store document metadata for local review (%s)",
      async (mode) => {
        const f = await seed(),
          db = await database.getDb();
        if (mode === "UNCONFIRMED")
          await db
            .collection("sourceDocuments")
            .updateOne({ _id: f.sourceDocumentId } as never, {
              $set: { remoteUploadStatus: "PENDING" },
            });
        if (mode === "DELETED")
          await db
            .collection("sourceDocuments")
            .updateOne({ _id: f.sourceDocumentId } as never, {
              $set: { deletedAt: new Date() },
            });
        if (mode === "WRONG_TYPE")
          await db
            .collection("sourceDocuments")
            .updateOne({ _id: f.sourceDocumentId } as never, {
              $set: { sourceType: "WASTE_RECEIPT" },
            });
        await db
          .collection("sourceDocuments")
          .updateOne({ _id: f.sourceDocumentId } as never, {
            $set: {
              storageKey: "private-never-disclosed",
              signedUrl: "https://secret.invalid/private",
            },
          });
        const before = await db
          .collection("sourceDocuments")
          .findOne({ _id: f.sourceDocumentId } as never);
        const r = await previewTranscriptionReview(
          db,
          mode === "FOREIGN" ? randomUUID() : f.storeId,
          { sourceDocumentId: f.sourceDocumentId },
        );
        expect(r.status).toBe(
          mode === "READY" ? "REVIEW_LOCAL" : "UNAVAILABLE",
        );
        expect(r.source !== null).toBe(mode === "READY");
        expect(JSON.stringify(r)).not.toMatch(
          /private-never-disclosed|secret.invalid|signedUrl|storageKey|localId|corrections|conflictCount/,
        );
        expect(
          await db
            .collection("sourceDocuments")
            .findOne({ _id: f.sourceDocumentId } as never),
        ).toEqual(before);
        expect(
          await db
            .collection("commercialReviewDecisions")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      },
    );
    it.each([false, true])(
      "persists a genuine source-scoped server invitation once, or rolls back foreign scope (forged=%s)",
      async (forged) => {
        const f = await seed(),
          db = await database.getDb(),
          chat = chatFixture(randomUUID);
        chat.storeId = f.storeId;
        chat.conversation.storeId = f.storeId;
        chat.message.storeId = f.storeId;
        chat.message.attachments = [
          {
            sourceDocumentId: f.sourceDocumentId,
            filename: "week.pdf",
            mediaType: "application/pdf",
          },
        ];
        await db
          .collection<Document & { _id: string }>("copilotConversations")
          .insertOne({ _id: chat.conversation.id, ...chat.conversation });
        await db
          .collection<Document & { _id: string }>("copilotMessages")
          .insertOne({ _id: chat.message.id, ...chat.message });
        const preview = await previewTranscriptionReview(db, f.storeId, {
          sourceDocumentId: f.sourceDocumentId,
        });
        if (!preview.source) throw Error("SOURCE_MISSING");
        const value = forged
          ? { ...preview, source: { ...preview.source, storeId: randomUUID() } }
          : preview;
        const generate = vi.fn(async () => ({
          output: {
            language: "fr-FR",
            summary: "Comparaison à ouvrir sur cet appareil.",
            facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: "fixture-transcription-review",
            inputTokens: null,
            outputTokens: null,
          },
          toolEvidence: preview.evidence,
          transcriptionReviewPreviews: [value],
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
        if (forged) {
          await expect(runCopilotTurn(dependencies, turn)).rejects.toThrow();
          expect(
            await db.collection("copilotMessages").countDocuments({
              conversationId: chat.conversation.id,
              role: { $in: ["ASSISTANT", "TOOL"] },
            }),
          ).toBe(0);
        } else {
          await runCopilotTurn(dependencies, turn);
          const rows = await db
            .collection("copilotMessages")
            .find({ conversationId: chat.conversation.id, role: "TOOL" })
            .toArray();
          expect(rows).toHaveLength(1);
          const { _id, ...raw } = rows[0]!;
          expect(readTranscriptionReviewProposal(raw).content.source).toEqual(
            preview.source,
          );
          expect(
            await db
              .collection("syncChanges")
              .countDocuments({ entityId: _id }),
          ).toBe(1);
          expect(
            (await runCopilotTurn(dependencies, turn)).alreadyApplied,
          ).toBe(true);
          expect(generate).toHaveBeenCalledTimes(1);
        }
        expect(
          await db
            .collection("commercialReviewDecisions")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      },
    );
    function review(
      page: CommercialReviewPage,
      overrides: Partial<CommercialReviewDecision> = {},
    ): CommercialReviewDecision {
      return {
        id: randomUUID(),
        storeId: page.storeId,
        sourceDocumentId: page.sourceDocumentId,
        pageId: page.id,
        sourceBlockIndex: 0,
        checksum: page.checksum,
        decision: "CONFIRMED_TRANSCRIPTION",
        corrections: [{ name: "sellingPrice", value: "3,49 €/kg" }],
        reviewedAt: new Date().toISOString(),
        ...overrides,
      };
    }
    function command(d: CommercialReviewDecision): SyncCommand {
      return {
        commandId: randomUUID(),
        localSequence: 1,
        type: "COMMERCIAL_TRANSCRIPTION_REVIEW",
        entityType: "commercial_review_decision",
        entityId: d.id,
        expectedRemoteVersion: null,
        createdAt: new Date().toISOString(),
        payload: d,
      };
    }
    async function push(
      d: CommercialReviewDecision,
      c = command(d),
      storeId = d.storeId,
      deviceId = randomUUID(),
    ) {
      return createMongoSyncPushService(database).push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          storeId,
          deviceId,
          commands: [c],
        },
        randomUUID(),
      );
    }
    async function runConflictScenario(mode: "MANUAL" | "COPILOT") {
      const f = await seed(),
        actorId = randomUUID(),
        aDevice = randomUUID(),
        bDevice = randomUUID(),
        dir = mkdtempSync(join(tmpdir(), "fl-transcription-mongo-")),
        path = join(dir, "restored.db"),
        a = new ReceiptTestDatabase(new DatabaseSync(":memory:")),
        b = new ReceiptTestDatabase(new DatabaseSync(":memory:")),
        c = new ReceiptTestDatabase(new DatabaseSync(path)),
        pushing = createMongoSyncPushService(database),
        pulling = createMongoSyncPullService(database),
        bootstrap = createMongoSyncBootstrapService(database);
      let cClosed = false;
      const service = (db: ReceiptTestDatabase, deviceId: string) =>
        new MobileSyncService(
          db,
          {
            push: (r) => pushing.push(r, randomUUID(), actorId),
            pull: (storeId, cursor) =>
              pulling.pull(storeId, {
                cursor,
                limit: 500,
                commercialReview: "true",
              }),
            bootstrap: (storeId) =>
              bootstrap.bootstrap(
                {
                  storeId,
                  userId: actorId,
                  deviceId,
                  storeName: "Test",
                  role: "MANAGER",
                  sessionId: randomUUID(),
                },
                { rawObservationDays: 90, commercialReview: "true" },
              ),
          },
          {
            appVersion: "test",
            deviceId,
            commercialReview: true,
            copilotOwnerId: actorId,
          },
        );
      try {
        await registerCommercialReviewPages(
          database,
          f.storeId,
          f.sourceDocumentId,
        );
        for (const db of [a, b, c]) await runLocalMigrations(db);
        const syncA = service(a, aDevice),
          syncB = service(b, bDevice),
          syncC = service(c, randomUUID()),
          repoA = new CommercialReviewRepository(a),
          repoB = new CommercialReviewRepository(b, receiptReviewDigest),
          accepted = review(f.page),
          local = review(f.page, { decision: "DISMISSED", corrections: [] });
        await syncA.sync(f.storeId);
        await syncB.sync(f.storeId);
        await repoA.review(accepted, aDevice, randomUUID());
        await repoB.review(local, bDevice, randomUUID());
        expect((await syncA.sync(f.storeId)).pushed).toBe(1);
        expect((await syncB.sync(f.storeId)).conflicts).toBe(1);
        const first = (await new ConflictRepository(b).listOpen(f.storeId))[0]!,
          outbox = new OutboxRepository(b),
          original = (await outbox.getById(first.commandId!))!,
          clone = await outbox.enqueue({
            ...original,
            commandId: randomUUID(),
          });
        await outbox.markSyncing(clone.commandId);
        const response = await pushing.push(
          {
            syncProtocolVersion: 1,
            appVersion: "test",
            storeId: f.storeId,
            deviceId: bDevice,
            commands: [
              {
                commandId: clone.commandId,
                localSequence: clone.localSequence,
                type: clone.commandType,
                entityType: clone.entityType,
                entityId: clone.entityId,
                expectedRemoteVersion: null,
                createdAt: clone.createdAt,
                payload: clone.payload as SyncCommand["payload"],
              },
            ],
          },
          "repeat-transcription",
        );
        expect(response.results[0]).toMatchObject({
          status: "CONFLICT",
          remoteVersion: 1,
        });
        await new ConflictRepository(b).recordPushConflict(
          clone,
          response.results[0]!,
        );
        await outbox.markConflict(
          clone.commandId,
          "COMMERCIAL_REVIEW_ALREADY_RECORDED",
        );
        const compared = await repoB.reviewConflict(
            f.storeId,
            local.id,
            actorId,
          ),
          action = {
            actorId,
            deviceId: bDevice,
            actionId: randomUUID(),
            reviewHash: compared.hash,
            canResolve: () => true,
          };
        expect(compared.group).toHaveLength(2);
        expect(compared.canResolve).toBe(true);
        expect(compared.remote).toEqual(accepted);
        if (mode === "COPILOT") {
          const preview = await previewTranscriptionReview(
            await database.getDb(),
            f.storeId,
            { sourceDocumentId: f.sourceDocumentId },
          );
          expect(preview.status).toBe("REVIEW_LOCAL");
          const chat = await attachTranscriptionChat(
              b,
              { storeId: f.storeId, ownerId: actorId, deviceId: bDevice },
              f.page,
              preview,
            ),
            list = await chat.controller.list(chat.message);
          expect((await syncB.sync(f.storeId)).pushed).toBe(2);
          expect(list.items.map((r) => r.id)).toEqual([local.id]);
          const review = await chat.controller.review(chat.message, local.id);
          if (review.status !== "READY") throw Error("CHAT_REVIEW_NOT_READY");
          const outcome = await chat.controller.confirm(
            chat.message,
            local.id,
            review.review.hash,
            true,
          );
          expect(outcome.remoteId).toBe(accepted.id);
          expect(
            await chat.controller.confirm(
              chat.message,
              local.id,
              review.review.hash,
              true,
            ),
          ).toEqual(outcome);
        } else
          await repoB.useRemoteDecision(
            f.storeId,
            local.id,
            accepted.id,
            action,
          );

        expect((await syncB.sync(f.storeId)).pushed).toBe(0);
        await syncC.sync(f.storeId);
        expect(
          await new CommercialReviewRepository(c).decisions(f.storeId),
        ).toEqual([{ decision: accepted, state: "SYNCED" }]);
        expect(await repoB.decisions(f.storeId)).toEqual([
          { decision: accepted, state: "SYNCED" },
        ]);
        expect((await outbox.getById(original.commandId))!.status).toBe(
          "FAILED",
        );
        expect((await outbox.getById(clone.commandId))!.status).toBe("FAILED");
        expect(await outbox.countActive(f.storeId)).toEqual({
          pending_count: 0,
          failed_count: 0,
        });
        expect(await new ConflictRepository(b).listOpen(f.storeId)).toEqual([]);
        if (mode === "MANUAL")
          await repoB.useRemoteDecision(
            f.storeId,
            local.id,
            accepted.id,
            action,
          );
        await syncB.sync(f.storeId);
        const remoteDb = await database.getDb();
        expect(
          await remoteDb
            .collection("commercialReviewDecisions")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(1);
        expect(
          await remoteDb.collection("syncChanges").countDocuments({
            storeId: f.storeId,
            entityType: "commercial_review_decision",
          }),
        ).toBe(1);
        for (const name of [
          "offers",
          "commercialWeekPlans",
          "salesObservations",
          "wasteObservations",
        ])
          expect(
            await remoteDb
              .collection(name)
              .countDocuments({ storeId: f.storeId }),
          ).toBe(0);
        c.db.close();
        cClosed = true;
        const restored = new ReceiptTestDatabase(new DatabaseSync(path));
        try {
          expect(
            await new CommercialReviewRepository(restored).decisions(f.storeId),
          ).toEqual([{ decision: accepted, state: "SYNCED" }]);
          expect(
            await new OutboxRepository(restored).listPending(f.storeId),
          ).toEqual([]);
        } finally {
          restored.db.close();
        }
      } finally {
        a.db.close();
        b.db.close();
        if (!cClosed) c.db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
    it.each(["MANUAL", "COPILOT"] as const)(
      "retains the first accepted transcription across a real conflict group, third-device restore and offline reopen (%s)",
      runConflictScenario,
      60000,
    );

    it("registers immutable page snapshots exactly once under concurrent delivery", async () => {
      const { storeId, sourceDocumentId, pageId, page } = await seed();
      const db = await database.getDb();
      const original = await db
        .collection("commercialDocumentAiPages")
        .findOne({ sourceDocumentId });
      await Promise.all([
        registerCommercialReviewPages(database, storeId, sourceDocumentId),
        registerCommercialReviewPages(database, storeId, sourceDocumentId),
      ]);
      expect(
        await db
          .collection("commercialReviewPages")
          .countDocuments({ storeId }),
      ).toBe(1);
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ storeId, entityType: "commercial_review_page" }),
      ).toBe(1);
      expect(
        await db
          .collection("commercialDocumentAiPages")
          .findOne({ sourceDocumentId }),
      ).toEqual(original);
      const result = await createMongoSyncPullService(database).pull(storeId, {
        limit: 500,
        commercialReview: "true",
      });
      expect(result.changes[0]).toMatchObject({
        entityId: pageId,
        entity: page,
      });
    }, 20000);
    it("omits new entities for old clients while new bootstrap restores them", async () => {
      const { storeId, page } = await seed();
      await registerCommercialReviewPages(database, storeId);
      const old = await createMongoSyncPullService(database).pull(storeId, {
        limit: 500,
      });
      expect(old.changes).toEqual([]);
      expect(old.nextCursor).toBeTruthy();
      const store = {
        storeId,
        storeName: "Rayon test",
        role: "MANAGER",
        userId: randomUUID(),
        sessionId: randomUUID(),
        deviceId: randomUUID(),
      };
      const bootstrap = await createMongoSyncBootstrapService(
        database,
      ).bootstrap(store, { rawObservationDays: 90, commercialReview: "true" });
      expect(bootstrap.entities.commercialReviewPages).toEqual([page]);
      const legacy = await createMongoSyncBootstrapService(database).bootstrap(
        store,
        { rawObservationDays: 90 },
      );
      expect(legacy.entities.commercialReviewPages).toBeUndefined();
    }, 20000);
    it("retries the same immutable decision without double publication and restores it on another device", async () => {
      const { storeId, page } = await seed();
      await registerCommercialReviewPages(database, storeId);
      const d = review(page),
        c = command(d),
        deviceId = randomUUID();
      expect((await push(d, c, storeId, deviceId)).results[0]?.status).toBe(
        "APPLIED",
      );
      expect((await push(d, c, storeId, deviceId)).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      const db = await database.getDb();
      expect(
        await db
          .collection("commercialReviewDecisions")
          .countDocuments({ storeId }),
      ).toBe(1);
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId,
          entityType: "commercial_review_decision",
        }),
      ).toBe(1);
      expect(await db.collection("offers").countDocuments({ storeId })).toBe(0);
      expect(
        await db.collection("commercialOperations").countDocuments({ storeId }),
      ).toBe(0);
      const boot = await createMongoSyncBootstrapService(database).bootstrap(
        {
          storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        },
        { rawObservationDays: 90, commercialReview: "true" },
      );
      expect(boot.entities.commercialReviewDecisions).toEqual([
        { id: d.id, storeId, remoteVersion: 1, decision: d },
      ]);
    }, 20000);
    it("rejects source tampering and reports another device's different choice as conflict", async () => {
      const { storeId, page } = await seed();
      await registerCommercialReviewPages(database, storeId);
      const d = review(page);
      for (const invalid of [
        review(page, { checksum: "wrong" }),
        review(page, {
          corrections: [{ name: "purchasePrice", value: "1 €" }],
        }),
      ])
        expect((await push(invalid)).results[0]?.status).toBe("REJECTED");
      expect((await push(d, command(d), randomUUID())).results[0]?.status).toBe(
        "REJECTED",
      );
      expect((await push(d)).results[0]?.status).toBe("APPLIED");
      const other = review(page, { decision: "DISMISSED", corrections: [] });
      const result = await push(other);
      expect(result.results[0]).toMatchObject({
        status: "CONFLICT",
        remoteEntity: { id: d.id, decision: d },
        error: { code: "COMMERCIAL_REVIEW_ALREADY_RECORDED" },
      });
      expect(
        await (
          await database.getDb()
        )
          .collection("commercialReviewDecisions")
          .countDocuments({ storeId }),
      ).toBe(1);
    }, 20000);
    it("keeps independent block decisions in the same store", async () => {
      const { storeId, page, pageId } = await seed();
      page.blocks.push({ ...page.blocks[0]!, sourceBlockIndex: 1 });
      const db = await database.getDb();
      await db
        .collection<{ _id: string }>("commercialDocumentAiPages")
        .updateOne({ _id: pageId }, { $set: { "draft.blocks": page.blocks } });
      await registerCommercialReviewPages(database, storeId);
      expect((await push(review(page))).results[0]?.status).toBe("APPLIED");
      expect(
        (await push(review(page, { sourceBlockIndex: 1 }))).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await db
          .collection("commercialReviewDecisions")
          .countDocuments({ storeId }),
      ).toBe(2);
    }, 20000);
  },
);
