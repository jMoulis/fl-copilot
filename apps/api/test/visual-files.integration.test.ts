import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  visualLibraryFixture,
  testVisualId,
} from "../../../scripts/test-visual-library-fixtures";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { parseEnvironment } from "../src/config";
import { createMongoSyncPushService } from "../src/sync/push-service";
import {
  createVisualFileService,
  type VisualFileStorage,
} from "../src/products/visual-file-service";
import { visualBytesHash } from "../src/products/visual-image-normalization";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private visual files on Mongo replica set",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_visual_files_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
    async function setup() {
      const f = visualLibraryFixture(),
        db = await database.getDb();
      const bytes = new Uint8Array(
        await sharp({
          create: { width: 20, height: 10, channels: 3, background: "#7733aa" },
        })
          .png()
          .toBuffer(),
      );
      f.asset = {
        ...f.asset,
        mimeType: "image/png",
        width: 20,
        height: 10,
        sizeBytes: bytes.byteLength,
        contentHash: visualBytesHash(bytes),
      };
      f.asset.id = testVisualId("visual_asset", f.storeId, f.asset.contentHash);
      await db.collection("storeMemberships").insertOne({
        storeId: f.storeId,
        userId: f.actorId,
        role: "MANAGER",
        active: true,
      });
      const result = await createMongoSyncPushService(database).push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          deviceId: f.deviceId,
          storeId: f.storeId,
          commands: [
            {
              commandId: randomUUID(),
              localSequence: 1,
              type: "VISUAL_ASSET_UPSERT",
              entityType: "visual_asset",
              entityId: f.asset.id,
              expectedRemoteVersion: null,
              createdAt: f.at,
              payload: f.asset,
            },
          ],
        },
        "visual-file-test",
        f.actorId,
      );
      expect(result.results[0]?.status).toBe("APPLIED");
      let stage = "";
      const objects = new Map<string, Uint8Array>();
      const storage: VisualFileStorage = {
        uploadUrl: async (key) => {
          stage = key;
          return `https://private.example.test/${key}`;
        },
        read: async (key) => objects.get(key) ?? null,
        writeImmutable: async (key, b) => {
          const prior = objects.get(key);
          if (prior && visualBytesHash(prior) !== visualBytesHash(b))
            throw Error("IMMUTABLE_TEST");
          objects.set(key, b.slice());
        },
        removeStaging: async (key) => {
          objects.delete(key);
        },
      };
      const context = {
        storeId: f.storeId,
        userId: f.actorId,
        role: "MANAGER",
      };
      return {
        f,
        db,
        bytes,
        objects,
        storage,
        context,
        service: createVisualFileService(database, storage),
        stage: () => stage,
      };
    }
    it("stores one transactional proof, replays completion and lets another authorized device recover verified bytes", async () => {
      const s = await setup(),
        init = await s.service.init(s.context, s.f.asset.id);
      s.objects.set(s.stage(), s.bytes);
      const manifest = await s.service.complete(
        s.context,
        s.f.asset.id,
        init.uploadId!,
      );
      expect(
        await s.service.complete(s.context, s.f.asset.id, init.uploadId!),
      ).toEqual(manifest);
      expect(
        await s.db
          .collection("visualAssetFiles")
          .countDocuments({ storeId: s.f.storeId }),
      ).toBe(1);
      const original = (await s.service.read(s.context, s.f.asset.id, "source"))
        .bytes;
      expect(visualBytesHash(original)).toBe(s.f.asset.contentHash);
      expect(
        (
          await sharp(
            (await s.service.read(s.context, s.f.asset.id, "preview")).bytes,
          ).metadata()
        ).format,
      ).toBe("jpeg");
      expect(await s.service.init(s.context, s.f.asset.id)).toMatchObject({
        state: "READY",
        manifest,
      });
      const upload = await s.db
        .collection<{ _id: string }>("visualAssetUploads")
        .findOne({ _id: init.uploadId! });
      expect(upload).toMatchObject({
        status: "CONFIRMED",
        cleanupComplete: true,
      });
      expect(s.objects.has(s.stage())).toBe(false);
      await s.db.collection<{ _id: string }>("visualAssets").updateOne(
        { _id: s.f.asset.id },
        {
          $set: {
            review: { status: "REVOKED", actorId: s.f.actorId, at: s.f.at },
          },
        },
      );
      await expect(
        s.service.read(s.context, s.f.asset.id, "source"),
      ).rejects.toMatchObject({ publicCode: "VISUAL_REVIEW_REQUIRED" });
    });
    it("rechecks membership inside the real commit and preserves a staged original when access changes during normalization", async () => {
      const s = await setup(),
        init = await s.service.init(s.context, s.f.asset.id);
      s.objects.set(s.stage(), s.bytes);
      const write = s.storage.writeImmutable;
      let revoked = false;
      s.storage.writeImmutable = async (...args) => {
        await write(...args);
        if (!revoked) {
          revoked = true;
          await s.db
            .collection("storeMemberships")
            .updateOne(
              { storeId: s.f.storeId, userId: s.f.actorId },
              { $set: { active: false } },
            );
        }
      };
      await expect(
        s.service.complete(s.context, s.f.asset.id, init.uploadId!),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(
        await s.db
          .collection("visualAssetFiles")
          .countDocuments({ storeId: s.f.storeId }),
      ).toBe(0);
      expect(s.objects.has(s.stage())).toBe(true);
      await s.db
        .collection("storeMemberships")
        .updateOne(
          { storeId: s.f.storeId, userId: s.f.actorId },
          { $set: { active: true } },
        );
      expect(
        await s.service.complete(s.context, s.f.asset.id, init.uploadId!),
      ).toMatchObject({ assetId: s.f.asset.id });
    });
  },
);
