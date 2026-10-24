import { sourceObjectKey } from "../src/uploads/source-upload-service";
import { vi } from "vitest";
import type { Document } from "mongodb";
import { runCopilotTurn } from "../src/copilot/turn-service";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { readVisualActionProposal } from "@fl-copilot/domain";
import { readCataloguePreview } from "../src/copilot/catalogue-preview-tool";
import { loadProductEditorSnapshot } from "../../mobile/src/products/product-editor-service";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { visualActionFixture } from "../../../scripts/test-visual-action-fixtures";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { previewVisualAction } from "../src/copilot/visual-actions-tool";
import { buildVisualActionMessages } from "../src/copilot/visual-action-messages";
import {
  syncPushRequestSchema,
  bootstrapQuerySchema,
  syncPullQuerySchema,
} from "@fl-copilot/sync-contracts";
import { validateVisualActionPreview } from "@fl-copilot/domain";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { VisualLibraryRepository } from "../../mobile/src/products/visual-library-repository";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "canonical visual actions from actual server preview to another SQLite",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_visual_actions_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    }, 60000);
    async function seed(s: Awaited<ReturnType<typeof visualActionFixture>>) {
      const db = await database.getDb(),
        push = createMongoSyncPushService(database);
      await db.collection("storeMemberships").insertOne({
        storeId: s.f.storeId,
        userId: s.f.actorId,
        role: "MANAGER",
        active: true,
      });
      if (s.input.action === "ASSIGN_SOURCE") {
        const m = s.sourcePhoto,
          key = sourceObjectKey(s.f.storeId, {
            sourceDocumentId: m.sourceDocumentId,
            sourceType: m.sourceType,
            filename: m.filename,
            checksum: m.checksum,
            sizeBytes: m.sizeBytes,
            mimeType: m.mimeType,
          });
        await db.collection("sourceDocuments").insertOne({
          _id: m.sourceDocumentId as never,
          storeId: s.f.storeId,
          sourceType: m.sourceType,
          originalFilename: m.filename,
          checksum: m.checksum,
          sizeBytes: m.sizeBytes,
          mimeType: m.mimeType,
          objectKey: key,
          createdAt: new Date(m.registeredAt),
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        });
        await db.collection("sourceUploads").insertOne({
          storeId: s.f.storeId,
          userId: s.f.actorId,
          sourceDocumentId: m.sourceDocumentId,
          sourceType: m.sourceType,
          filename: m.filename,
          checksum: m.checksum,
          sizeBytes: m.sizeBytes,
          mimeType: m.mimeType,
          objectKey: key,
          status: "CONFIRMED",
        });
      }
      const source = [
        { entityType: "product", payload: s.f.product },
        { entityType: "visual_asset", payload: s.f.asset },
        { entityType: "visual_asset", payload: s.asset },
        { entityType: "visual_identity", payload: s.f.identity },
        { entityType: "visual_identity", payload: s.identity },
        { entityType: "product_visual_link", payload: s.f.link },
      ];
      const seeded = await createMongoSyncPushService(
        database,
        () => new Date(s.f.at),
      ).push(
        syncPushRequestSchema.parse({
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId: randomUUID(),
          storeId: s.f.storeId,
          commands: source.map((r, i) => ({
            commandId: randomUUID(),
            localSequence: i + 1,
            type: `${r.entityType.toUpperCase()}_UPSERT`,
            entityType: r.entityType,
            entityId: r.payload.id,
            expectedRemoteVersion: null,
            createdAt: r.payload.updatedAt,
            payload: r.payload,
          })),
        }),
        "fixture",
        s.f.actorId,
      );
      expect(seeded.results.every((r) => r.status === "APPLIED")).toBe(true);
      return { db, push };
    }
    it.each([
      "ASSIGN_LIBRARY",
      "REMOVE_PRODUCT",
      "REVOKE_CURRENT",
      "ASSIGN_SOURCE",
    ] as const)(
      "prepares/confirms %s once, pushes canonical metadata and restores it offline",
      async (action) => {
        const s = await visualActionFixture(action),
          { db, push } = await seed(s),
          dir = mkdtempSync(join(tmpdir(), "fl-visual-restore-")),
          path = join(dir, "other.db");
        let other: VisualTestDatabase | undefined;
        try {
          const preview = await previewVisualAction(db, s.f.storeId, s.input, {
            ownerId: s.f.actorId,
          });
          expect(preview.status).toBe("READY");
          const actualProduct = (
            await readCataloguePreview(db, s.f.storeId, {
              action: "INSPECT",
              productId: s.f.product.id,
              patch: {},
            })
          ).before!.product.entity;
          expect(actualProduct).toEqual(
            (await loadProductEditorSnapshot(s.products, s.f.product.id))!
              .product.entity,
          );
          expect(preview.basis).toEqual(s.preview.basis);
          expect(JSON.stringify(preview)).not.toMatch(
            /sourceUrl|https:|license|confirmedBy|storageKey|localUri/,
          );
          expect(() =>
            validateVisualActionPreview(randomUUID(), s.input, preview),
          ).toThrow("SCOPE");
          const message = buildVisualActionMessages(s.assistant, [preview])[0]!;
          expect(message).toEqual(s.message);
          if (action === "ASSIGN_SOURCE")
            await s.controller.prepareSourcePhoto(message);
          await s.controller.confirm(
            message,
            s.state.review!.basisHash,
            s.consent,
          );
          const command = (
            await new OutboxRepository(s.db).listPending(s.f.storeId)
          ).find(
            (c) =>
              c.entityType ===
              (action === "REVOKE_CURRENT"
                ? "visual_asset"
                : "product_visual_link"),
          )!;
          const packet = syncPushRequestSchema.parse({
            syncProtocolVersion: 1,
            appVersion: "test",
            deviceId: s.f.deviceId,
            storeId: s.f.storeId,
            commands: (action === "ASSIGN_SOURCE"
              ? (
                  await new OutboxRepository(s.db).listPending(s.f.storeId)
                ).filter((c) =>
                  [
                    "visual_asset",
                    "visual_identity",
                    "product_visual_link",
                  ].includes(c.entityType),
                )
              : [command]
            ).map((c) => ({
              commandId: c.commandId,
              localSequence: c.localSequence,
              type: c.commandType,
              entityType: c.entityType,
              entityId: c.entityId,
              expectedRemoteVersion: c.expectedRemoteVersion,
              createdAt: c.createdAt,
              payload: c.payload,
            })),
          });
          const sent = await push.push(packet, "action", s.f.actorId);
          expect(sent.results.every((r) => r.status === "APPLIED")).toBe(true);
          expect(
            (await push.push(packet, "replay", s.f.actorId)).results[0]?.status,
          ).toBe("ALREADY_APPLIED");
          other = new VisualTestDatabase(new DatabaseSync(path));
          await runLocalMigrations(other);
          const pull = createMongoSyncPullService(database),
            boot = createMongoSyncBootstrapService(database),
            deviceId = randomUUID();
          await new MobileSyncService(
            other,
            {
              push: (r) => push.push(r, randomUUID(), s.f.actorId),
              pull: (storeId, cursor) =>
                pull.pull(
                  storeId,
                  syncPullQuerySchema.parse({ cursor, visualLibrary: "true" }),
                ),
              bootstrap: () =>
                boot.bootstrap(
                  {
                    storeId: s.f.storeId,
                    userId: s.f.actorId,
                    storeName: "Fixture",
                    role: "MANAGER",
                    sessionId: randomUUID(),
                    deviceId,
                  },
                  bootstrapQuerySchema.parse({ visualLibrary: "true" }),
                ),
            },
            {
              deviceId,
              appVersion: "test",
              visualLibrary: true,
              copilotOwnerId: s.f.actorId,
            },
          ).sync(s.f.storeId);
          const kind =
              action === "REVOKE_CURRENT"
                ? "visual_asset"
                : "product_visual_link",
            expected = (await s.library.get(
              kind,
              s.f.storeId,
              command.entityId,
            ))!.entity,
            restored = (await new VisualLibraryRepository(other).get(
              kind,
              s.f.storeId,
              command.entityId,
            ))!;
          expect(restored.entity).toEqual(expected);
          expect(restored.syncState).toBe("SYNCED");
          other.raw.close();
          other = undefined;
          const offline = new VisualTestDatabase(new DatabaseSync(path));
          try {
            expect(
              (await new VisualLibraryRepository(offline).get(
                kind,
                s.f.storeId,
                command.entityId,
              ))!.entity,
            ).toEqual(expected);
            expect(
              offline.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!
                .n,
            ).toBe(0);
          } finally {
            offline.raw.close();
          }
        } finally {
          other?.raw.close();
          s.db.raw.close();
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
    it.each(["FOREIGN_OWNER", "WITHDRAWN", "UPLOAD_BINDING_CHANGED"] as const)(
      "refuses source-photo metadata on %s without touching product visuals",
      async (mode) => {
        const s = await visualActionFixture("ASSIGN_SOURCE");
        try {
          const { db } = await seed(s);
          if (mode === "WITHDRAWN")
            await db
              .collection("sourceDocuments")
              .updateOne(
                { storeId: s.f.storeId },
                { $set: { deletedAt: new Date() } },
              );
          if (mode === "UPLOAD_BINDING_CHANGED")
            await db
              .collection("sourceUploads")
              .updateOne(
                { storeId: s.f.storeId },
                { $set: { checksum: `sha256:${"d".repeat(64)}` } },
              );
          const before = await db
            .collection("productVisualLinks")
            .find({ storeId: s.f.storeId })
            .toArray();
          await expect(
            previewVisualAction(db, s.f.storeId, s.input, {
              ownerId: mode === "FOREIGN_OWNER" ? randomUUID() : s.f.actorId,
            }),
          ).rejects.toThrow(/STORE_PHOTO_/);
          expect(
            await db
              .collection("productVisualLinks")
              .find({ storeId: s.f.storeId })
              .toArray(),
          ).toEqual(before);
        } finally {
          s.db.raw.close();
        }
      },
    );
    it.each([false, true])(
      "persists a genuine server-produced visual card once, or rolls back a forged scope (forged=%s)",
      async (forged) => {
        const s = await visualActionFixture(),
          { db } = await seed(s);
        try {
          await db
            .collection<Document & { _id: string }>("copilotConversations")
            .insertOne({ _id: s.chat.conversation.id, ...s.chat.conversation });
          await db
            .collection<Document & { _id: string }>("copilotMessages")
            .insertOne({ _id: s.chat.message.id, ...s.chat.message });
          const preview = await previewVisualAction(db, s.f.storeId, s.input, {
              ownerId: s.f.actorId,
            }),
            before = await db
              .collection("productVisualLinks")
              .findOne({ storeId: s.f.storeId });
          const value = forged
            ? { ...preview, basis: { ...preview.basis, storeId: randomUUID() } }
            : preview;
          const generate = vi.fn(async () => ({
            output: {
              language: "fr-FR",
              summary: "Choix d’image préparé, à confirmer.",
              facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
              interpretation: [],
              recommendations: [],
              questions: [],
            },
            metadata: {
              requestedModel: "test",
              resolvedModel: "test",
              responseId: "fixture-visual-action",
              inputTokens: null,
              outputTokens: null,
            },
            toolEvidence: preview.evidence,
            visualActionPreviews: [value],
          }));
          const dependencies = {
            db,
            provider: { model: "test", generate } as CopilotAiProvider,
            authorize: async () => ({
              storeId: s.f.storeId,
              ownerId: s.f.actorId,
              canRespond: true,
            }),
            loadContext: async () =>
              detectCopilotConflicts({
                batch: scoreCopilotPriorities({
                  storeId: s.f.storeId,
                  evaluatedAt: s.chat.message.createdAt,
                  candidates: [],
                }),
                intents: [],
              }),
          };
          const turn = {
            conversationId: s.chat.conversation.id,
            userMessageId: s.chat.message.id,
            replyId: randomUUID(),
          };
          if (forged) {
            await expect(runCopilotTurn(dependencies, turn)).rejects.toThrow();
            expect(
              await db.collection("copilotMessages").countDocuments({
                conversationId: s.chat.conversation.id,
                role: { $in: ["ASSISTANT", "TOOL"] },
              }),
            ).toBe(0);
          } else {
            await runCopilotTurn(dependencies, turn);
            const cards = await db
              .collection("copilotMessages")
              .find({ conversationId: s.chat.conversation.id, role: "TOOL" })
              .toArray();
            expect(cards).toHaveLength(1);
            const { _id, ...raw } = cards[0]!;
            expect(readVisualActionProposal(raw).content.input).toEqual(
              s.input,
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
              .collection("productVisualLinks")
              .findOne({ storeId: s.f.storeId }),
          ).toEqual(before);
        } finally {
          s.db.raw.close();
        }
      },
    );
  },
);
