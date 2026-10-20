import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { parseEnvironment } from "../src/config";
import {
  createMongoSourceUploadService,
  type SourceBlobMetadata,
} from "../src/uploads/source-upload-service";
import { readStorePhoto } from "../src/copilot/store-photo-reader";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "department photo source upload and private reading on Mongo",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_store_photo_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
    it("retains an immutable scoped source, reads verified pixels, and never queues receipt or PDF processing", async () => {
      const db = await database.getDb(),
        scope = { storeId: randomUUID(), ownerId: randomUUID() },
        sourceDocumentId = randomUUID();
      const bytes = new Uint8Array(
        await sharp({
          create: { width: 40, height: 30, channels: 3, background: "#245a43" },
        })
          .png()
          .toBuffer(),
      );
      const input = {
        sourceDocumentId,
        sourceType: "STORE_PHOTO" as const,
        filename: "rayon.png",
        mimeType: "image/png" as const,
        sizeBytes: bytes.length,
        checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      };
      let blob: SourceBlobMetadata | null = null;
      const normalize = vi.fn(),
        extract = vi.fn(),
        validate = vi.fn(),
        match = vi.fn(),
        readDraft = vi.fn(),
        dispatch = vi.fn();
      const service = createMongoSourceUploadService(
        database,
        {
          createUploadUrl: async () => "https://upload.invalid/photo",
          head: async () => blob,
        },
        () => new Date("2026-10-20T12:00:00Z"),
        { normalize },
        { extract },
        { validate },
        { match },
        { read: readDraft },
        dispatch,
      );
      const init = await service.init(scope.storeId, scope.ownerId, input);
      const read = vi.fn(async () => bytes.slice());
      await expect(
        readStorePhoto(db, scope, { sourceDocumentId }, read),
      ).rejects.toThrow("STORE_PHOTO_UNAVAILABLE");
      expect(read).not.toHaveBeenCalled();
      blob = {
        pathname: init.objectKey,
        size: bytes.length,
        contentType: input.mimeType,
        url: "https://blob.invalid/source",
        etag: "photo-etag",
      };
      for (let i = 0; i < 2; i++)
        expect(
          await service.complete(scope.storeId, init.uploadId, {
            checksum: input.checksum,
            sizeBytes: input.sizeBytes,
          }),
        ).toMatchObject({
          sourceDocumentId,
          remoteUploadStatus: "CONFIRMED",
          jobId: null,
        });
      const result = await readStorePhoto(
        db,
        scope,
        { sourceDocumentId },
        read,
      );
      expect(result.snapshot.source.checksum).toBe(input.checksum);
      expect(await sharp(result.image).metadata()).toMatchObject({
        format: "jpeg",
        width: 40,
        height: 30,
      });
      expect(read).toHaveBeenCalledWith(
        init.objectKey,
        bytes.length,
        undefined,
      );
      expect(
        await db
          .collection<{ _id: string }>("sourceDocuments")
          .countDocuments({ _id: sourceDocumentId }),
      ).toBe(1);
      expect(
        await db
          .collection("sourceUploads")
          .countDocuments({ sourceDocumentId }),
      ).toBe(1);
      for (const spy of [
        normalize,
        extract,
        validate,
        match,
        readDraft,
        dispatch,
      ])
        expect(spy).not.toHaveBeenCalled();
      expect(
        await db
          .collection("commercialDocumentJobs")
          .countDocuments({ sourceDocumentId }),
      ).toBe(0);
      for (const foreign of [
        { ...scope, ownerId: randomUUID() },
        { ...scope, storeId: randomUUID() },
      ]) {
        const rejectedRead = vi.fn(async () => bytes);
        await expect(
          readStorePhoto(db, foreign, { sourceDocumentId }, rejectedRead),
        ).rejects.toThrow("STORE_PHOTO_UNAVAILABLE");
        expect(rejectedRead).not.toHaveBeenCalled();
      }
      await db
        .collection<{ _id: string }>("sourceDocuments")
        .updateOne(
          { _id: sourceDocumentId },
          { $set: { deletedAt: new Date() } },
        );
      const withdrawn = vi.fn(async () => bytes);
      await expect(
        readStorePhoto(db, scope, { sourceDocumentId }, withdrawn),
      ).rejects.toThrow("STORE_PHOTO_UNAVAILABLE");
      expect(withdrawn).not.toHaveBeenCalled();
    });
  },
);
