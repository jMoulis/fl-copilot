import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { previewStoreConflict } from "../src/copilot/store-conflict-tool";
import { buildStoreConflictMessages } from "../src/copilot/store-conflict-messages";
import { nativeLayoutChatConflictFixture } from "../../../scripts/test-layout-chat-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../scripts/test-receipt-publication-sqlite";
import { syncPushRequestSchema } from "@fl-copilot/sync-contracts";
import { type StoreLayout } from "@fl-copilot/domain";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { StoreLayoutRepository } from "../../mobile/src/store/layout-repository";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { applyCopilotRecord } from "../../mobile/src/copilot/conversation-repository";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "conversational plan comparison through real Mongo and SQLite",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_layout_chat_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    });
    it.each(["KEEP_LOCAL", "ADOPT_REMOTE"] as const)(
      "reviews and confirms %s, synchronizes once and restores the plan on another reopened SQLite",
      async (decision) => {
        const s = await nativeLayoutChatConflictFixture(),
          dir = mkdtempSync(join(tmpdir(), "fl-chat-layout-mongo-")),
          path = join(dir, "other.db"),
          other = new ReceiptTestDatabase(new DatabaseSync(path)),
          pushing = createMongoSyncPushService(database),
          pulling = createMongoSyncPullService(database),
          boot = createMongoSyncBootstrapService(database);
        let closed = false;
        const service = (db: ReceiptTestDatabase, deviceId: string) =>
          new MobileSyncService(
            db,
            {
              push: (request) =>
                pushing.push(request, randomUUID(), s.scope.ownerId),
              pull: (storeId, cursor) =>
                pulling.pull(storeId, {
                  cursor,
                  limit: 500,
                  storeLayouts: "true",
                }),
              bootstrap: (storeId) =>
                boot.bootstrap(
                  {
                    storeId,
                    userId: s.scope.ownerId,
                    deviceId,
                    role: "MANAGER",
                    storeName: "Test",
                    sessionId: randomUUID(),
                  },
                  { rawObservationDays: 90, storeLayouts: "true" },
                ),
            },
            { appVersion: "test", deviceId, storeLayouts: true },
          );
        const seed = (p: StoreLayout) =>
          pushing.push(
            syncPushRequestSchema.parse({
              syncProtocolVersion: 1,
              appVersion: "test",
              deviceId: randomUUID(),
              storeId: p.storeId,
              commands: [
                {
                  commandId: randomUUID(),
                  localSequence: 1,
                  type: "STORE_LAYOUT_UPSERT",
                  entityType: "store_layout",
                  entityId: p.id,
                  expectedRemoteVersion: p.version === 1 ? null : p.version - 1,
                  createdAt: p.updatedAt,
                  payload: p,
                },
              ],
            }),
            randomUUID(),
            s.scope.ownerId,
          );
        try {
          await runLocalMigrations(other);
          expect((await seed(s.base)).results[0]!.status).toBe("APPLIED");
          expect((await seed(s.review.remote)).results[0]!.status).toBe(
            "APPLIED",
          );
          // Prepare only this fixture's sending boundary; unrelated source fixtures are
          // not part of this layout transport proof.
          await s.a.runAsync(
            "UPDATE sync_outbox SET status='ACKNOWLEDGED' WHERE entity_type<>'store_layout'",
          );
          await s.a.runAsync(
            "DELETE FROM sync_conflicts WHERE entity_type='store_layout'",
          );
          await s.a.runAsync(
            "UPDATE store_layouts SET sync_state='PENDING' WHERE store_id=?",
            s.scope.storeId,
          );
          await s.a.runAsync(
            "UPDATE sync_outbox SET status='PENDING' WHERE command_id=?",
            s.review.command.commandId,
          );
          const sourceTables = [
              "products",
              "source_documents",
              "source_records",
              "local_files",
              "sales_observations",
              "waste_observations",
              "waste_receipts",
              "waste_lines",
            ],
            source = () =>
              sourceTables.map((t) =>
                s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
              ),
            before = source();
          const sync = service(s.a, s.scope.deviceId);
          expect((await sync.push(s.scope.storeId)).conflicts).toBe(1);
          const preview = await previewStoreConflict(
            await database.getDb(),
            s.scope.storeId,
            { kind: "STORE_LAYOUT", entityId: null },
          );
          expect(JSON.stringify(preview)).not.toMatch(
            /content|furniture|surfaces|assemblies/,
          );
          await expect(
            previewStoreConflict(await database.getDb(), randomUUID(), {
              kind: "STORE_LAYOUT",
              entityId: null,
            }),
          ).rejects.toThrow("UNAVAILABLE");
          const message = buildStoreConflictMessages(s.f.assistant, [
            preview,
          ])[0]!;
          await s.a.withExclusiveTransactionAsync((tx) =>
            applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
          );
          const state = await s.controller.open(message);
          expect(state.status).toBe("READY");
          expect(
            (
              await s.controller.confirm(
                message,
                state.review!.basisHash,
                decision,
                true,
              )
            ).status,
          ).toBe("COMPLETED");
          expect((await sync.sync(s.scope.storeId)).pushed).toBe(
            decision === "KEEP_LOCAL" ? 1 : 0,
          );
          const after = (await s.repository.get(s.scope.storeId))!.entity;
          await service(other, randomUUID()).sync(s.scope.storeId);
          expect(
            (await new StoreLayoutRepository(
              other,
              randomUUID,
              undefined,
              receiptReviewDigest,
            ).get(s.scope.storeId))!.entity,
          ).toEqual(after);
          const commandCount = await (
            await database.getDb()
          )
            .collection("processedCommands")
            .countDocuments({ storeId: s.scope.storeId });
          expect(commandCount).toBeGreaterThan(2);
          await s.controller.confirm(
            message,
            state.review!.basisHash,
            decision,
            true,
          );
          await sync.sync(s.scope.storeId);
          expect(
            await (
              await database.getDb()
            )
              .collection("processedCommands")
              .countDocuments({ storeId: s.scope.storeId }),
          ).toBe(commandCount);
          expect(source()).toEqual(before);
          other.db.close();
          closed = true;
          const reopened = new DatabaseSync(path);
          try {
            expect(
              (await new StoreLayoutRepository(
                new ReceiptTestDatabase(reopened),
                randomUUID,
              ).get(s.scope.storeId))!.entity,
            ).toEqual(after);
          } finally {
            reopened.close();
          }
        } finally {
          if (!closed) other.db.close();
          s.db.close();
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
  },
);
