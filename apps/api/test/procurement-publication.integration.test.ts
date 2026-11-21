import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MongoClient, type Db } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { procurementPublicationFixture } from "../../../scripts/test-procurement-publication-fixtures";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  createMongoSourceUploadService,
  type SourceBlobMetadata,
} from "../src/uploads/source-upload-service";
import { createSourceOriginalService } from "../src/uploads/source-original-service";
import { runMongoMigrations } from "../src/database/migrations";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  type SyncCommand,
  type SyncPushRequest,
} from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "procurement local confirmation → private upload → canonical sync",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = new MongoClient(uri!);
      await client.connect();
      db = client.db("fl_procurement_" + randomUUID().replaceAll("-", ""));
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });
    const service = () => ({
      getDb: async () => db,
      checkHealth: async () => "connected" as const,
      close: async () => {},
    });
    const setup = async () => {
      const f = await procurementPublicationFixture();
      await db.collection("storeMemberships").insertOne({
        storeId: f.config.storeId,
        userId: f.ownerId,
        active: true,
        role: "MANAGER",
      });
      await db
        .collection<Record<string, unknown> & { _id: string }>(
          "storeContextSettings",
        )
        .insertOne({ _id: f.config.id, ...f.config });
      const p = await f.repository.publish(f.publicationInput, () => undefined);
      const command: SyncCommand = {
        commandId: f.publicationInput.commandId,
        localSequence: 1,
        type: "PROCUREMENT_CATALOGUE_PUBLISH",
        entityType: "procurement_catalogue_snapshot",
        entityId: p.id,
        createdAt: p.confirmedAt,
        expectedRemoteVersion: null,
        payload: p,
      };
      const request: SyncPushRequest = {
        syncProtocolVersion: 1,
        appVersion: "test",
        procurementCatalogues: true,
        storeId: p.storeId,
        deviceId: f.publicationInput.deviceId,
        commands: [command],
      };
      const blobs = new Map<
        string,
        { meta: SourceBlobMetadata; bytes: Uint8Array }
      >();
      const storage = {
        createUploadUrl: async ({ pathname }: { pathname: string }) =>
          "https://upload.invalid/" + encodeURIComponent(pathname),
        head: async (key: string) => blobs.get(key)?.meta ?? null,
      };
      const upload = createMongoSourceUploadService(service(), storage);
      const push = createMongoSyncPushService(service(), () => new Date(), {
        read: async (key) => blobs.get(key)?.bytes ?? null,
      });
      const send = () => push.push(request, randomUUID(), f.ownerId);
      const receive = async () => {
        const i = await upload.init(p.storeId, f.ownerId, {
          sourceDocumentId: p.sourceDocumentId,
          sourceType: "PROCUREMENT_CATALOGUE",
          filename: p.originalFilename,
          mimeType: "application/json",
          sizeBytes: f.bytes.length,
          checksum: p.checksum,
        });
        blobs.set(i.objectKey, {
          bytes: f.bytes,
          meta: {
            pathname: i.objectKey,
            size: f.bytes.length,
            contentType: "application/json",
            etag: "immutable",
            url: "https://test.private.blob.vercel-storage.com/original",
          },
        });
        await upload.complete(
          p.storeId,
          i.uploadId,
          { checksum: p.checksum, sizeBytes: f.bytes.length },
          f.ownerId,
        );
      };
      return {
        ...f,
        p,
        command,
        request,
        blobs,
        storage,
        upload,
        push,
        send,
        receive,
      };
    };
    it("retries missing originals, scopes uploads to their owner, replays once and restores an immutable snapshot on a second device", async () => {
      const f = await setup();
      const second = new VisualTestDatabase(new DatabaseSync(":memory:"));
      try {
        expect((await f.send()).results[0]).toMatchObject({
          status: "RETRYABLE_ERROR",
          error: { code: "PROCUREMENT_ORIGINAL_PENDING" },
        });
        const uploadInput = {
          sourceDocumentId: f.p.sourceDocumentId,
          sourceType: "PROCUREMENT_CATALOGUE" as const,
          filename: f.p.originalFilename,
          mimeType: "application/json" as const,
          sizeBytes: f.bytes.length,
          checksum: f.p.checksum,
        };
        const pending = await f.upload.init(
          f.p.storeId,
          f.ownerId,
          uploadInput,
        );
        await expect(
          f.upload.init(f.p.storeId, randomUUID(), uploadInput),
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
          f.upload.complete(
            f.p.storeId,
            pending.uploadId,
            { checksum: f.p.checksum, sizeBytes: f.bytes.length },
            randomUUID(),
          ),
        ).rejects.toMatchObject({ statusCode: 404 });
        await f.receive();
        const pull = createMongoSyncPullService(service()),
          bootstrap = createMongoSyncBootstrapService(service());
        const scope = {
          storeId: f.p.storeId,
          userId: f.ownerId,
          sessionId: randomUUID(),
          deviceId: randomUUID(),
          storeName: "Test",
          role: "MANAGER" as const,
        };
        const transport = {
          bootstrap: () =>
            bootstrap.bootstrap(
              scope,
              bootstrapQuerySchema.parse({
                procurementCatalogues: "true",
                storeContext: "true",
              }),
            ),
          pull: (id: string, cursor: string) =>
            pull.pull(
              id,
              syncPullQuerySchema.parse({
                cursor,
                procurementCatalogues: "true",
                storeContext: "true",
              }),
              f.ownerId,
            ),
          push: (r: SyncPushRequest) => f.push.push(r, randomUUID(), f.ownerId),
        };
        const sync = new MobileSyncService(f.device, transport, {
          appVersion: "test",
          deviceId: f.publicationInput.deviceId,
          copilotOwnerId: f.ownerId,
          procurementCatalogues: true,
          sleep: async () => {},
        });
        expect(await sync.sync(f.p.storeId)).toMatchObject({
          pushed: 1,
          conflicts: 0,
          failed: 0,
        });
        expect(
          f.device.raw
            .prepare(
              "SELECT sync_state,dirty FROM procurement_catalogue_snapshots",
            )
            .get(),
        ).toEqual({ sync_state: "SYNCED", dirty: 0 });
        expect((await f.send()).results[0]?.status).toBe("ALREADY_APPLIED");
        expect(
          await db
            .collection("procurementCatalogueSnapshots")
            .countDocuments({ storeId: f.p.storeId }),
        ).toBe(1);
        const legacy = await pull.pull(
          f.p.storeId,
          syncPullQuerySchema.parse({}),
          f.ownerId,
        );
        expect(legacy.changes).toEqual([]);
        await runLocalMigrations(second);
        // Starts from an already advanced legacy cursor: capability adoption must backfill.
        await second.runAsync(
          "INSERT INTO sync_inbox_state(store_id,cursor,last_successful_sync_at,protocol_version) VALUES(?,?,?,1)",
          f.p.storeId,
          legacy.nextCursor,
          f.p.confirmedAt,
        );
        const other = new MobileSyncService(second, transport, {
          appVersion: "test",
          deviceId: randomUUID(),
          copilotOwnerId: f.ownerId,
          procurementCatalogues: true,
          sleep: async () => {},
        });
        await other.sync(f.p.storeId);
        const row = second.raw
          .prepare(
            "SELECT payload_json,sync_state FROM procurement_catalogue_snapshots",
          )
          .get();
        expect(JSON.parse(String(row?.payload_json))).toEqual(f.p);
        expect(row?.sync_state).toBe("SYNCED");
        for (const table of [
          "products",
          "purchasePriceObservations",
          "salesObservations",
          "wasteObservations",
        ])
          expect(
            await db.collection(table).countDocuments({ storeId: f.p.storeId }),
          ).toBe(0);
        const originals = createSourceOriginalService(service(), f.storage);
        expect(
          await originals.manifest(
            f.p.storeId,
            f.ownerId,
            f.p.sourceDocumentId,
          ),
        ).toMatchObject({ access: "OWNER", ownerId: f.ownerId });
        await expect(
          originals.manifest(f.p.storeId, randomUUID(), f.p.sourceDocumentId),
        ).rejects.toMatchObject({ statusCode: 404 });
        const changed = structuredClone(f.command);
        changed.commandId = randomUUID();
        (changed.payload as typeof f.p).catalogue.offers[0]!.weight = "9";
        expect(
          (
            await f.push.push(
              { ...f.request, commands: [changed] },
              randomUUID(),
              f.ownerId,
            )
          ).results[0]?.status,
        ).toBe("CONFLICT");
        const duplicate = structuredClone(f.command);
        duplicate.commandId = randomUUID();
        duplicate.entityId = randomUUID();
        (duplicate.payload as typeof f.p).id = duplicate.entityId;
        expect(
          (
            await f.push.push(
              { ...f.request, commands: [duplicate] },
              randomUUID(),
              f.ownerId,
            )
          ).results[0]?.status,
        ).toBe("CONFLICT");
        expect(
          await db
            .collection("procurementCatalogueSnapshots")
            .countDocuments({ storeId: f.p.storeId }),
        ).toBe(1);
      } finally {
        f.device.raw.close();
        second.raw.close();
      }
    });
    it("records a duplicate-offline-import conflict without blocking pull or replacing either local identity", async () => {
      const f = await setup();
      const second = await procurementPublicationFixture(
        f.bytes,
        f.config,
        f.ownerId,
      );
      try {
        await f.receive();
        expect((await f.send()).results[0]?.status).toBe("APPLIED");
        const p = await second.repository.publish(
          second.publicationInput,
          () => undefined,
        );
        const bootstrap = createMongoSyncBootstrapService(service()),
          pull = createMongoSyncPullService(service());
        const scope = {
          storeId: f.p.storeId,
          userId: f.ownerId,
          deviceId: second.publicationInput.deviceId,
          sessionId: randomUUID(),
          storeName: "Test",
          role: "MANAGER" as const,
        };
        const sync = new MobileSyncService(
          second.device,
          {
            bootstrap: () =>
              bootstrap.bootstrap(
                scope,
                bootstrapQuerySchema.parse({ procurementCatalogues: "true" }),
              ),
            pull: (id, cursor) =>
              pull.pull(
                id,
                syncPullQuerySchema.parse({
                  cursor,
                  procurementCatalogues: "true",
                }),
                f.ownerId,
              ),
            push: (request) => f.push.push(request, randomUUID(), f.ownerId),
          },
          {
            appVersion: "test",
            deviceId: scope.deviceId,
            copilotOwnerId: f.ownerId,
            procurementCatalogues: true,
            sleep: async () => {},
          },
        );
        expect(await sync.sync(f.p.storeId)).toMatchObject({
          conflicts: 1,
          failed: 0,
          pushed: 0,
        });
        expect(
          second.device.raw
            .prepare(
              "SELECT id,sync_state FROM procurement_catalogue_snapshots",
            )
            .get(),
        ).toEqual({ id: p.id, sync_state: "CONFLICT" });
        expect(
          second.device.raw
            .prepare("SELECT retention_status FROM local_files")
            .get(),
        ).toEqual({ retention_status: "RETAINED" });
        expect(
          await db
            .collection("procurementCatalogueSnapshots")
            .countDocuments({ storeId: f.p.storeId }),
        ).toBe(1);
      } finally {
        f.device.raw.close();
        second.device.raw.close();
      }
    });
    it.each([
      "wrong-pdv",
      "missing-pdv",
      "forged-price",
      "changed-original",
      "wrong-owner",
      "assistant",
      "wrong-store",
    ])("preserves the source and rejects or defers %s", async (kind) => {
      const f = await setup();
      try {
        await f.receive();
        if (kind === "wrong-pdv")
          await db
            .collection("storeContextSettings")
            .updateOne(
              { storeId: f.p.storeId },
              { $set: { pdvCode: "99999" } },
            );
        if (kind === "missing-pdv")
          await db
            .collection("storeContextSettings")
            .updateOne({ storeId: f.p.storeId }, { $unset: { pdvCode: "" } });
        if (kind === "forged-price")
          (
            f.command.payload as typeof f.p
          ).catalogue.offers[0]!.tariff!.purchasePrice = "0";
        if (kind === "changed-original")
          for (const blob of f.blobs.values())
            blob.bytes = new Uint8Array([1, 2, 3]);
        if (kind === "assistant")
          await db
            .collection("storeMemberships")
            .updateOne(
              { storeId: f.p.storeId, userId: f.ownerId },
              { $set: { role: "ASSISTANT" } },
            );
        if (kind === "wrong-store")
          (f.command.payload as typeof f.p).storeId = randomUUID();
        const result = await f.push.push(
          f.request,
          randomUUID(),
          kind === "wrong-owner" ? randomUUID() : f.ownerId,
        );
        expect(result.results[0]?.status).toBe(
          kind === "missing-pdv" || kind === "wrong-pdv"
            ? "RETRYABLE_ERROR"
            : "REJECTED",
        );
        expect(
          await db
            .collection("procurementCatalogueSnapshots")
            .countDocuments({ storeId: f.p.storeId }),
        ).toBe(0);
        expect(
          f.device.raw
            .prepare("SELECT retention_status FROM local_files")
            .get(),
        ).toEqual({ retention_status: "RETAINED" });
        if (kind === "wrong-pdv" || kind === "missing-pdv") {
          await db
            .collection("storeContextSettings")
            .updateOne(
              { storeId: f.p.storeId },
              { $set: { pdvCode: f.config.pdvCode } },
            );
          expect((await f.send()).results[0]?.status).toBe("APPLIED");
          expect(
            await db
              .collection("procurementCatalogueSnapshots")
              .countDocuments({ storeId: f.p.storeId }),
          ).toBe(1);
        }
      } finally {
        f.device.raw.close();
      }
    });
  },
);
