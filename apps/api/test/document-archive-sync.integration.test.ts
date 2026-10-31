import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { documentArchiveFixture } from "../../../scripts/test-document-archive-fixtures";
import { ReceiptTestDatabase } from "../../../scripts/test-receipt-publication-sqlite";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  documentArchiveSchema,
  bootstrapQuerySchema,
  syncPullQuerySchema,
  type SyncPushRequest,
  type DocumentArchive,
} from "@fl-copilot/sync-contracts";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { applyBootstrap } from "../../mobile/src/sync/apply-bootstrap";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { SourceDocumentRepository } from "../../mobile/src/documents/source-document-repository";
import {
  DocumentArchiveRepository,
  applyDocumentArchive,
} from "../../mobile/src/documents/document-archive-repository";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "personal document archive synchronization",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE:
            "flc_archive_test_" + randomUUID().replaceAll("-", ""),
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      await (await database.getDb()).dropDatabase();
      await database.close();
    });
    const packet = (
      entity: DocumentArchive,
      commandId = randomUUID(),
    ): SyncPushRequest => ({
      syncProtocolVersion: 1,
      appVersion: "test",
      deviceId: randomUUID(),
      storeId: entity.storeId,
      commercialOriginalSources: true,
      commands: [
        {
          commandId,
          localSequence: 1,
          type: "DOCUMENT_ARCHIVE_SET",
          entityType: "document_archive",
          entityId: entity.id,
          expectedRemoteVersion: null,
          createdAt: entity.updatedAt,
          payload: entity,
        },
      ],
    });
    const marker = () =>
      documentArchiveSchema.parse({
        id: randomUUID(),
        ownerId: randomUUID(),
        storeId: randomUUID(),
        targetKind: "COMMERCIAL_DOCUMENT",
        archived: true,
        version: 1,
        updatedAt: "2026-10-31T08:00:00.000Z",
      });

    it("synchronizes archive/restore between two SQLite devices, including upgrade with a cursor already beyond the archive event", async () => {
      const a = await documentArchiveFixture(),
        bdb = new DatabaseSync(":memory:"),
        b = new ReceiptTestDatabase(bdb);
      try {
        await runLocalMigrations(b);
        await a.a.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
        const copy = (await a.sources.getFileForDocument(a.document.id))!;
        await new SourceDocumentRepository(b).createCommercialPdf({
          document: { ...a.document, localFileUri: "file:///device-b.pdf" },
          file: { ...copy, id: randomUUID(), localUri: "file:///device-b.pdf" },
        });
        const ownerId = a.scope.ownerId,
          storeId = a.scope.storeId;
        const push = createMongoSyncPushService(database),
          pull = createMongoSyncPullService(database),
          bootstrap = createMongoSyncBootstrapService(database);
        const principal = {
          storeId,
          userId: ownerId,
          deviceId: a.scope.deviceId,
          sessionId: randomUUID(),
          storeName: "Test",
          role: "MANAGER" as const,
        };
        const historyCalls: string[] = [];
        const service = (db: ReceiptTestDatabase, deviceId: string) =>
          new MobileSyncService(
            db,
            {
              bootstrap: () =>
                bootstrap.bootstrap(
                  principal,
                  bootstrapQuerySchema.parse({
                    commercialOriginalSources: "true",
                  }),
                ),
              push: (input) => push.push(input, randomUUID(), ownerId),
              pull: (id, cursor) =>
                pull.pull(
                  id,
                  syncPullQuerySchema.parse({
                    cursor,
                    documentArchives: "true",
                    commercialOriginalSources: "true",
                  }),
                  ownerId,
                ),
              documentArchiveHistory: (id, cursor) => {
                historyCalls.push(deviceId);
                return pull.pull(
                  id,
                  syncPullQuerySchema.parse({
                    cursor,
                    documentArchives: "true",
                    documentArchiveHistory: "true",
                  }),
                  ownerId,
                );
              },
            },
            {
              deviceId,
              appVersion: "test",
              copilotOwnerId: ownerId,
              documentArchives: true,
              commercialOriginalSources: true,
              maxRetries: 0,
            },
          );
        const sa = service(a.a, a.scope.deviceId),
          sb = service(b, randomUUID()),
          rb = new DocumentArchiveRepository(b, a.scope);
        const command = a.context();
        await a.archives.set(
          a.document.id,
          "COMMERCIAL_DOCUMENT",
          true,
          command,
        );
        await sa.sync(storeId);
        const snapshot = await bootstrap.bootstrap(
          principal,
          bootstrapQuerySchema.parse({ commercialOriginalSources: "true" }),
        );
        await applyBootstrap(b, storeId, snapshot, ownerId);
        expect(await rb.list()).toEqual([]);
        await sb.sync(storeId);
        expect(await rb.list()).toMatchObject([
          { id: a.document.id, archived: true, version: 1 },
        ]);
        await rb.set(a.document.id, "COMMERCIAL_DOCUMENT", false, {
          ...a.context(),
          deviceId: randomUUID(),
        });
        await sb.sync(storeId);
        await sa.sync(storeId);
        expect(await a.archives.list()).toMatchObject([
          { archived: false, version: 2 },
        ]);
        expect(await rb.list()).toMatchObject([
          { archived: false, version: 2 },
        ]);
        expect(historyCalls).toHaveLength(2);
        const source = await new SourceDocumentRepository(b).getDocument(
          a.document.id,
        );
        expect(source?.deletedAt).toBeNull();
        expect(source?.localFileUri).toBe("file:///device-b.pdf");
        expect(
          await (
            await database.getDb()
          )
            .collection("sourceDocuments")
            .countDocuments({ storeId }),
        ).toBe(0);
        // Retry of an already processed older intent cannot apply it again.
        const payload = (await a.a.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM sync_outbox WHERE command_id=?",
          command.commandId,
        ))!;
        const replay = packet(
          documentArchiveSchema.parse(JSON.parse(payload.payload_json)),
          command.commandId,
        );
        replay.deviceId = a.scope.deviceId;
        const response = await push.push(replay, "replay", ownerId);
        expect(response.results[0]?.status).toBe("ALREADY_APPLIED");
        await applyDocumentArchive(
          a.a,
          a.scope,
          response.results[0]!.remoteEntity,
          command.commandId,
        );
        expect(await a.archives.list()).toMatchObject([
          { archived: false, version: 2 },
        ]);
      } finally {
        a.db.close();
        bdb.close();
      }
    });

    it("isolates two owners sharing one document, hides markers from old clients and rejects spoofed ownership", async () => {
      const entity = marker(),
        push = createMongoSyncPushService(database),
        pull = createMongoSyncPullService(database),
        other = randomUUID();
      const first = await push.push(packet(entity), "first", entity.ownerId);
      expect(first.results[0]?.status).toBe("APPLIED");
      await push.push(
        packet({ ...entity, ownerId: other, archived: false }),
        "other",
        other,
      );
      const own = await pull.pull(
        entity.storeId,
        syncPullQuerySchema.parse({
          documentArchives: "true",
          documentArchiveHistory: "true",
          limit: 1,
        }),
        entity.ownerId,
      );
      expect(own.changes).toHaveLength(1);
      expect(own.changes[0]?.entity).toMatchObject({
        ownerId: entity.ownerId,
        archived: true,
      });
      expect(own.hasMore).toBe(false);
      const foreign = await pull.pull(
        entity.storeId,
        syncPullQuerySchema.parse({
          documentArchives: "true",
          documentArchiveHistory: "true",
        }),
        randomUUID(),
      );
      expect(foreign.changes).toEqual([]);
      expect(
        (await pull.pull(entity.storeId, syncPullQuerySchema.parse({})))
          .changes,
      ).toEqual([]);
      const denied = await push.push(packet(entity), "spoof", other);
      expect(denied.results[0]?.status).toBe("REJECTED");
      expect(denied.results[0]?.remoteEntity).toBeUndefined();
      const restored = await push.push(
        packet({ ...entity, archived: false, version: 99 }),
        "restore",
        entity.ownerId,
      );
      expect(restored.results[0]?.status).toBe("APPLIED");
      expect(restored.results[0]?.remoteVersion).toBe(2);
    });

    it("paginates archive-only history without scanning unrelated product changes", async () => {
      const a = marker(),
        push = createMongoSyncPushService(database),
        pull = createMongoSyncPullService(database);
      await push.push(packet(a), "one", a.ownerId);
      await push.push(packet({ ...a, id: randomUUID() }), "two", a.ownerId);
      const page = await pull.pull(
        a.storeId,
        syncPullQuerySchema.parse({
          documentArchives: "true",
          documentArchiveHistory: "true",
          limit: 1,
        }),
        a.ownerId,
      );
      expect(page.hasMore).toBe(true);
      expect(page.changes).toHaveLength(1);
      const next = await pull.pull(
        a.storeId,
        syncPullQuerySchema.parse({
          documentArchives: "true",
          documentArchiveHistory: "true",
          limit: 1,
          cursor: page.nextCursor,
        }),
        a.ownerId,
      );
      expect(next.hasMore).toBe(false);
      expect(next.changes).toHaveLength(1);
      expect(next.changes[0]?.entityId).not.toBe(page.changes[0]?.entityId);
    });
  },
);
