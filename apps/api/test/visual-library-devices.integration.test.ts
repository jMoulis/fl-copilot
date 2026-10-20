import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  type VisualFileManifest,
} from "@fl-copilot/sync-contracts";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { visualLibraryFixture } from "../../../scripts/test-visual-library-fixtures";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { ProductMasterRepository } from "../../mobile/src/products/product-master-repository";
import {
  assignCapturedVisual,
  assignLibraryVisual,
  loadVisualSelectionBasis,
  revokeLibraryVisual,
} from "../../mobile/src/products/visual-library-actions";
import { VisualLibraryRepository } from "../../mobile/src/products/visual-library-repository";
import { VisualFileJobs } from "../../mobile/src/products/visual-file-jobs";
import { VisualFileTransfer } from "../../mobile/src/products/visual-file-transfer";
import {
  VisualFileCache,
  visualFilePath,
} from "../../mobile/src/products/visual-file-cache";
import type { VisualFileStorage } from "../../mobile/src/products/visual-file-storage-port";
import {
  loadVisualLibraryState,
  resolveLibraryProduct,
} from "../../mobile/src/products/visual-library-state";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { parseEnvironment } from "../src/config";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import {
  createVisualFileService,
  type VisualFileStorage as ServerStorage,
} from "../src/products/visual-file-service";
import { visualBytesHash } from "../src/products/visual-image-normalization";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "visual library SQLite → Mongo → another SQLite device",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_visual_devices_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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

    it("retains an offline original over restart, restores a verified preview, preserves a manual choice over catalogue reimport, and propagates revocation", async () => {
      const f = visualLibraryFixture(),
        folder = await mkdtemp(join(tmpdir(), "fl-visual-devices-")),
        open = new Set<VisualTestDatabase>(),
        objects = new Map<string, Uint8Array>(),
        otherActor = randomUUID();
      let at = f.at;
      const close = (db: VisualTestDatabase) => {
        db.raw.close();
        open.delete(db);
      };
      const device = async (name: string, actor = f.actorId) => {
        const db = new VisualTestDatabase(
          new DatabaseSync(join(folder, `${name}.sqlite`)),
        );
        open.add(db);
        await runLocalMigrations(db);
        const context = {
          storeId: f.storeId,
          actorId: actor,
          deviceId: randomUUID(),
          canWrite: () => true,
          id: randomUUID,
          now: () => at,
        };
        const sync = new MobileSyncService(
          db,
          {
            push: (r) =>
              createMongoSyncPushService(database).push(r, randomUUID(), actor),
            pull: (storeId, cursor) =>
              createMongoSyncPullService(database).pull(
                storeId,
                syncPullQuerySchema.parse({ cursor, visualLibrary: "true" }),
                actor,
              ),
            bootstrap: () =>
              createMongoSyncBootstrapService(database).bootstrap(
                {
                  storeId: f.storeId,
                  userId: actor,
                  deviceId: context.deviceId,
                  sessionId: randomUUID(),
                  storeName: "Test isolé",
                  role: "MANAGER",
                },
                bootstrapQuerySchema.parse({ visualLibrary: "true" }),
              ),
          },
          {
            appVersion: "test",
            deviceId: context.deviceId,
            copilotOwnerId: actor,
            visualLibrary: true,
          },
        );
        const path = (
          store: string,
          variant: "SOURCE" | "PREVIEW",
          d: Parameters<VisualFileStorage["read"]>[2],
        ) => visualFilePath(store, variant, d.mimeType, d.contentHash);
        const verify = (
          bytes: Uint8Array,
          d: Parameters<VisualFileStorage["read"]>[2],
        ) => {
          if (
            visualBytesHash(bytes) !== d.contentHash ||
            bytes.byteLength !== d.sizeBytes
          )
            throw Error("VISUAL_FILE_INVALID");
          return bytes;
        };
        const files: VisualFileStorage = {
          capture: async () => {
            throw Error("PICKER_NOT_USED_IN_INTEGRATION");
          },
          read: async (store, variant, d) =>
            verify(
              new Uint8Array(
                await readFile(join(folder, name, path(store, variant, d))),
              ),
              d,
            ),
          write: async (store, variant, d, bytes) => {
            verify(bytes, d);
            const relativePath = path(store, variant, d),
              destination = join(folder, name, relativePath);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, bytes);
            return {
              relativePath,
              contentHash: d.contentHash,
              sizeBytes: d.sizeBytes,
            };
          },
          uri: async (store, variant, d) => {
            try {
              await files.read(store, variant, d);
              return `file://${join(folder, name, path(store, variant, d))}`;
            } catch {
              return null;
            }
          },
          removeCached: async (_store, proof) => {
            await rm(join(folder, name, proof.relativePath));
          },
          upload: async (store, d, url, headers) => {
            expect(Object.keys(headers)).not.toContain("authorization");
            objects.set(
              decodeURIComponent(new URL(url).pathname.slice(1)),
              await files.read(store, "SOURCE", d),
            );
          },
        };
        const principal = {
            storeId: f.storeId,
            userId: actor,
            role: "MANAGER",
          },
          service = createVisualFileService(database, storage),
          download = vi.fn(
            async (
              _store: string,
              manifest: VisualFileManifest,
              variant: "source" | "preview",
            ) =>
              (await service.read(principal, manifest.assetId, variant)).bytes,
          ),
          transfer = new VisualFileTransfer(
            db,
            {
              init: (_store, id) => service.init(principal, id),
              complete: (_store, id, upload) =>
                service.complete(principal, id, upload),
              manifest: (_store, id) => service.manifest(principal, id),
              download,
            },
            files,
            () => ({ storeId: f.storeId, userId: actor, canWrite: true }),
          ),
          jobs = new VisualFileJobs(
            db,
            transfer,
            () => ({ storeId: f.storeId, userId: actor, canWrite: true }),
            randomUUID,
          );
        return { db, context, sync, files, jobs, transfer, download };
      };
      const storage: ServerStorage = {
        uploadUrl: async (key) =>
          `https://visual.example.test/${encodeURIComponent(key)}`,
        read: async (key) => objects.get(key) ?? null,
        writeImmutable: async (key, bytes) => {
          const old = objects.get(key);
          if (old && visualBytesHash(old) !== visualBytesHash(bytes))
            throw Error("IMMUTABLE_TEST");
          objects.set(key, bytes.slice());
        },
        removeStaging: async (key) => {
          objects.delete(key);
        },
      };
      try {
        const remote = await database.getDb();
        await remote.collection("storeMemberships").insertMany(
          [f.actorId, otherActor].map((userId) => ({
            storeId: f.storeId,
            userId,
            role: "MANAGER",
            active: true,
          })),
        );
        let a = await device("a");
        await new ProductMasterRepository(a.db).upsertProduct(f.product, {
          commandId: randomUUID(),
          deviceId: a.context.deviceId,
        });
        const bytes = new Uint8Array(
            await sharp({
              create: {
                width: 32,
                height: 24,
                channels: 3,
                background: "#cc5533",
              },
            })
              .png()
              .toBuffer(),
          ),
          descriptor = {
            contentHash: visualBytesHash(bytes),
            mimeType: "image/png" as const,
            sizeBytes: bytes.byteLength,
            width: 32,
            height: 24,
          },
          proof = await a.files.write(f.storeId, "SOURCE", descriptor, bytes),
          asset = await assignCapturedVisual(
            a.db,
            await loadVisualSelectionBasis(a.db, f.product.id, a.context),
            { ...proof, ...descriptor },
            true,
            a.context,
          );
        expect(
          await remote
            .collection("visualAssets")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
        close(a.db);
        a = await device("a");
        expect(await a.files.read(f.storeId, "SOURCE", asset)).toEqual(bytes);
        expect(await a.sync.sync(f.storeId)).toMatchObject({
          pushed: 4,
          conflicts: 0,
          failed: 0,
        });
        expect(await a.jobs.process(f.storeId, f.actorId)).toMatchObject({
          completed: 2,
          failed: 0,
        });
        expect(await a.sync.sync(f.storeId)).toMatchObject({
          pushed: 0,
          conflicts: 0,
          failed: 0,
        });
        expect(
          await remote
            .collection("visualLibraryHistory")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(3);

        const b = await device("b", otherActor);
        await b.sync.bootstrap(f.storeId);
        const state = await loadVisualLibraryState(b.db, f.storeId, otherActor);
        expect(
          resolveLibraryProduct(state, f.storeId, f.product.id),
        ).toMatchObject({ kind: "ASSET", asset: { id: asset.id } });
        expect(state.files.size).toBe(0);
        await b.jobs.requestPreview(f.storeId, otherActor, asset.id);
        expect(await b.jobs.process(f.storeId, otherActor)).toMatchObject({
          completed: 1,
          failed: 0,
        });
        const cached = await new VisualFileCache(b.db).get(
          f.storeId,
          asset,
          "PREVIEW",
        );
        expect(cached?.manifest).toBeTruthy();
        expect(
          await b.files.uri(f.storeId, "PREVIEW", cached!.manifest!.preview),
        ).toBeTruthy();
        expect(b.download.mock.calls.map((c) => c[2])).toEqual(["preview"]);
        expect(
          await new VisualFileCache(b.db).get(f.storeId, asset, "SOURCE"),
        ).toBeNull();
        // A stale registry must not prevent a missing physical thumbnail being repaired.
        await b.files.removeCached(f.storeId, cached!);
        await b.jobs.requestPreview(f.storeId, otherActor, asset.id);
        await b.jobs.process(f.storeId, otherActor);
        expect(b.download).toHaveBeenCalledTimes(2);

        at = "2026-10-20T11:00:00.000Z";
        const basis = await loadVisualSelectionBasis(
            b.db,
            f.product.id,
            b.context,
          ),
          identity = await new VisualLibraryRepository(b.db).get(
            "visual_identity",
            f.storeId,
            basis.link!.entity.visualIdentityId,
          );
        await assignLibraryVisual(b.db, basis, identity!, b.context);
        expect(await b.sync.sync(f.storeId)).toMatchObject({
          pushed: 1,
          conflicts: 0,
          failed: 0,
        });
        await a.sync.sync(f.storeId);
        at = "2026-10-20T12:00:00.000Z";
        await new ProductMasterRepository(a.db).upsertProduct(
          {
            ...f.product,
            label: "TOMATE RONDE VRAC — libellé réimporté",
            version: 2,
            updatedAt: at,
          },
          {
            commandId: randomUUID(),
            deviceId: a.context.deviceId,
            expectedRemoteVersion: 1,
          },
        );
        await a.sync.sync(f.storeId);
        await b.sync.sync(f.storeId);
        const choice = await loadVisualSelectionBasis(
          b.db,
          f.product.id,
          b.context,
        );
        expect(choice.link!.entity).toMatchObject({
          id: basis.link!.entity.id,
          version: 2,
          overrideAssetId: null,
          linkType: "INHERITED_GENERIC",
          verifiedBy: otherActor,
        });
        expect(
          resolveLibraryProduct(
            await loadVisualLibraryState(b.db, f.storeId, otherActor),
            f.storeId,
            f.product.id,
          ).kind,
        ).toBe("ASSET");

        const before = await new VisualLibraryRepository(a.db).get(
          "visual_asset",
          f.storeId,
          asset.id,
        );
        await revokeLibraryVisual(a.db, before!, a.context);
        await a.sync.sync(f.storeId);
        await b.sync.sync(f.storeId);
        expect(
          resolveLibraryProduct(
            await loadVisualLibraryState(b.db, f.storeId, otherActor),
            f.storeId,
            f.product.id,
          ).kind,
        ).toBe("PLACEHOLDER");
        await expect(b.transfer.fetchPreview(asset.id)).rejects.toThrow(
          "VISUAL_ASSET_UNAVAILABLE",
        );
        expect(await a.files.read(f.storeId, "SOURCE", asset)).toEqual(bytes);
        const restored = await device("restored", otherActor);
        await restored.sync.bootstrap(f.storeId);
        expect(
          resolveLibraryProduct(
            await loadVisualLibraryState(restored.db, f.storeId, otherActor),
            f.storeId,
            f.product.id,
          ).kind,
        ).toBe("PLACEHOLDER");
        expect(restored.download).not.toHaveBeenCalled();
        expect(
          await remote
            .collection("salesObservations")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
      } finally {
        for (const db of open) db.raw.close();
        await rm(folder, { recursive: true, force: true });
      }
    }, 30000);
  },
);
