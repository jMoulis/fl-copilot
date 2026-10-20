import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import {
  createMongoSourceUploadService,
  type SourceBlobMetadata,
} from "../src/uploads/source-upload-service";
import { createSourceOriginalService } from "../src/uploads/source-original-service";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { SourceDocumentRepository } from "../../mobile/src/documents/source-document-repository";
import { SourceOriginalTransfer } from "../../mobile/src/documents/source-original-transfer";
import { SourceOriginalJobs } from "../../mobile/src/documents/source-original-jobs";
const hash = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "source original upload on device A to Mongo, verified original restoration on device B",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_original_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
    it("keeps exact source bytes/identity across SQLite restart without reupload, extraction or business mutation", async () => {
      const dir = await mkdtemp(join(tmpdir(), "fl-original-device-proof-")),
        a = new VisualTestDatabase(new DatabaseSync(join(dir, "a.sqlite")));
      let b = new VisualTestDatabase(new DatabaseSync(join(dir, "b.sqlite")));
      try {
        await runLocalMigrations(a);
        await runLocalMigrations(b);
        const storeId = randomUUID(),
          ownerId = randomUUID(),
          sourceId = randomUUID(),
          fileId = randomUUID(),
          at = new Date("2026-10-20T13:00:00Z");
        const bytes = new Uint8Array(
          await sharp({
            create: {
              width: 30,
              height: 20,
              channels: 3,
              background: "#245a43",
            },
          })
            .png()
            .toBuffer(),
        );
        const sourcePath = join(dir, "phone-a-original.png");
        await writeFile(sourcePath, bytes);
        const localUri = pathToFileURL(sourcePath).href;
        await new SourceDocumentRepository(a).createStorePhoto(
          {
            document: {
              id: sourceId,
              storeId,
              sourceType: "STORE_PHOTO",
              originalFilename: "rayon-original.png",
              localFileUri: localUri,
              checksum: hash(bytes),
              localProcessingStatus: "PENDING",
              remoteUploadStatus: "PENDING",
              version: 1,
              createdAt: at.toISOString(),
              updatedAt: at.toISOString(),
              syncState: "PENDING",
              dirty: true,
            },
            file: {
              id: fileId,
              storeId,
              sourceDocumentId: sourceId,
              localUri,
              mimeType: "image/png",
              sizeBytes: bytes.length,
              checksum: hash(bytes),
              retentionStatus: "RETAINED",
              uploadStatus: "PENDING",
              createdAt: at.toISOString(),
              updatedAt: at.toISOString(),
            },
          },
          ownerId,
        );
        let blob: SourceBlobMetadata | null = null,
          key = "";
        const normalize = vi.fn(),
          dispatch = vi.fn();
        const upload = createMongoSourceUploadService(
          database,
          {
            head: async () => blob,
            createUploadUrl: async (input) => {
              key = input.pathname;
              return "https://upload.test.invalid/original";
            },
          },
          () => at,
          { normalize },
          undefined,
          undefined,
          undefined,
          undefined,
          dispatch,
        );
        const uploader = vi.fn(async (input: { localUri: string }) => {
          expect(
            new Uint8Array(await readFile(fileURLToPath(input.localUri))),
          ).toEqual(bytes);
          blob = {
            pathname: key,
            size: bytes.length,
            contentType: "image/png",
            etag: "blob-exact-original-version",
            url: "https://test.private.blob.vercel-storage.com/original",
          };
        });
        const captured = await new SourceDocumentRepository(a).getDocument(
          sourceId,
        );
        const capturedFile = await new SourceDocumentRepository(
          a,
        ).getFileForDocument(sourceId);
        expect(captured?.id).toBe(sourceId);
        const input = {
          sourceDocumentId: captured!.id,
          sourceType: "STORE_PHOTO" as const,
          filename: captured!.originalFilename!,
          checksum: capturedFile!.checksum,
          sizeBytes: capturedFile!.sizeBytes,
          mimeType: "image/png" as const,
        };
        const initiated = await upload.init(storeId, ownerId, input);
        await uploader({ localUri: capturedFile!.localUri });
        expect(
          await upload.complete(
            storeId,
            initiated.uploadId,
            { checksum: input.checksum, sizeBytes: input.sizeBytes },
            ownerId,
          ),
        ).toMatchObject({ remoteUploadStatus: "CONFIRMED" });
        expect(await upload.init(storeId, ownerId, input)).toMatchObject({
          status: "ALREADY_UPLOADED",
        });
        const remote = createSourceOriginalService(
          database,
          { head: async () => blob },
          async () => blob!.url,
          () => at,
        );
        await expect(
          remote.download(storeId, randomUUID(), sourceId),
        ).rejects.toMatchObject({ statusCode: 404 });
        const scope = () => ({ storeId, userId: ownerId });
        const receive = vi.fn(async () => {
          const path = join(dir, "phone-b-original.png");
          await writeFile(path, bytes);
          const actual = new Uint8Array(await readFile(path));
          expect(hash(actual)).toBe(hash(bytes));
          return { localUri: pathToFileURL(path).href, views: null };
        });
        const files = {
          hash: async (text: string) => hash(text),
          receive,
          existing: vi.fn(
            async (
              manifest: { checksum: string; sizeBytes: number },
              path: string,
            ) => {
              const actual = await readFile(fileURLToPath(path));
              expect(hash(actual)).toBe(manifest.checksum);
              expect(actual.length).toBe(manifest.sizeBytes);
              return { localUri: path, views: null };
            },
          ),
        };
        const transport = {
          download: vi.fn((store: string, actor: string, id: string) =>
            remote.download(store, actor, id),
          ),
          manifest: vi.fn((store: string, actor: string, id: string) =>
            remote.manifest(store, actor, id),
          ),
        };
        const transfer = new SourceOriginalTransfer(
          b,
          transport,
          files,
          scope,
          randomUUID,
          () => at,
        );
        const jobs = new SourceOriginalJobs(
          b,
          transfer,
          scope,
          randomUUID,
          () => at,
        );
        const db = await database.getDb(),
          original = await db
            .collection("sourceDocuments")
            .findOne({ _id: sourceId as never });
        await jobs.request(sourceId);
        await jobs.process(storeId, ownerId);
        expect(
          await b.getFirstAsync("SELECT status FROM local_jobs"),
        ).toMatchObject({ status: "COMPLETED" });
        const local = await transfer.local(sourceId);
        expect(
          new Uint8Array(await readFile(fileURLToPath(local!.localUri))),
        ).toEqual(bytes);
        b.raw.close();
        b = new VisualTestDatabase(new DatabaseSync(join(dir, "b.sqlite")));
        await runLocalMigrations(b);
        transport.download.mockRejectedValue(Error("OFFLINE"));
        transport.manifest.mockRejectedValue(Error("OFFLINE"));
        await expect(
          new SourceOriginalTransfer(
            b,
            transport,
            files,
            scope,
            randomUUID,
            () => at,
          ).recover(sourceId),
        ).resolves.toEqual(local);
        expect(
          await db
            .collection("sourceDocuments")
            .findOne({ _id: sourceId as never }),
        ).toEqual(original);
        expect(await b.getFirstAsync("SELECT * FROM sync_outbox")).toBeNull();
        expect(
          await b.getFirstAsync("SELECT * FROM source_records"),
        ).toBeNull();
        expect(
          await db
            .collection("sourceUploads")
            .countDocuments({ storeId, sourceDocumentId: sourceId }),
        ).toBe(1);
        expect(uploader).toHaveBeenCalledTimes(1);
        expect(receive).toHaveBeenCalledTimes(1);
        expect(normalize).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
      } finally {
        a.raw.close();
        b.raw.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  },
);
