import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { Inngest } from "inngest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app.js";
import { parseEnvironment } from "../src/config.js";
import { AuthError, type AuthService } from "../src/auth/service.js";
import { createMongoDatabase } from "../src/database/mongo.js";
import type { DatabaseService } from "../src/database/types.js";
import { createMongoSourceUploadService } from "../src/uploads/source-upload-service.js";

const { blobHead } = vi.hoisted(() => ({ blobHead: vi.fn() }));
vi.mock("@vercel/blob", async (original) => ({
  ...(await original<typeof import("@vercel/blob")>()),
  head: blobHead,
}));

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "commercial upload ACK with real durable intent",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_upload_ack_${randomUUID().replaceAll("-", "")}`,
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

    async function fixture(failQueue = false) {
      const storeId = randomUUID(),
        userId = randomUUID(),
        sourceDocumentId = randomUUID();
      const input = {
        sourceDocumentId,
        sourceType: "WEEKLY_COMMERCIAL_PDF" as const,
        filename: "original.pdf",
        mimeType: "application/pdf" as const,
        sizeBytes: 4096,
        checksum: `sha256:${"a".repeat(64)}`,
      };
      const init = await createMongoSourceUploadService(database, {
        createUploadUrl: async () => "https://blob.example.test/upload",
        head: async () => null,
      }).init(storeId, userId, input);
      blobHead.mockResolvedValue({
        pathname: init.objectKey,
        size: input.sizeBytes,
        contentType: input.mimeType,
        url: "https://blob.example.test/private",
        etag: "test",
      });
      const db = await database.getDb();
      const port: DatabaseService = {
        ...database,
        close: async () => {},
        getDb: async () =>
          new Proxy(db, {
            get(target, property) {
              if (property === "collection")
                return (name: string) =>
                  name === "commercialDocumentJobs" && failQueue
                    ? {
                        updateOne: async () => {
                          throw Error("durable queue unavailable");
                        },
                      }
                    : target.collection(name);
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }) as Db,
      };
      const auth: AuthService = {
        requestChallenge: vi.fn(),
        verifyChallenge: vi.fn(),
        refreshSession: vi.fn(),
        logout: vi.fn(),
        authorizeStore: vi.fn(async (token, store) => {
          if (token !== "valid" || store !== storeId)
            throw new AuthError(
              403,
              "STORE_FORBIDDEN",
              "Magasin non autorisé.",
            );
          return {
            storeId,
            userId,
            deviceId: randomUUID(),
            sessionId: randomUUID(),
            role: "MANAGER",
            storeName: "Test",
          };
        }),
      };
      const tasks: Promise<void>[] = [];
      const app = buildApp(
        parseEnvironment({
          NODE_ENV: "test",
          INNGEST_EVENT_KEY: "unused-test-key",
          INNGEST_SIGNING_KEY: "unused-test-signing-key",
        }),
        {
          database: port,
          auth,
          waitUntil: (task) => {
            tasks.push(task);
          },
        },
      );
      const complete = (
        headers = { authorization: "Bearer valid", "x-store-id": storeId },
        payload = { checksum: input.checksum, sizeBytes: input.sizeBytes },
      ) =>
        app.inject({
          method: "POST",
          url: `/api/v1/uploads/${init.uploadId}/complete`,
          headers,
          payload,
        });
      return {
        app,
        complete,
        db,
        tasks,
        storeId,
        sourceDocumentId,
        input,
        init,
        recoverQueue: () => {
          failQueue = false;
        },
      };
    }

    it("confirms before delayed event delivery, preserves source/job progress on retry and uses the stable event identity", async () => {
      let finish!: (result: { ids: string[] }) => void;
      const send = vi.spyOn(Inngest.prototype, "send").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const f = await fixture();
      try {
        expect(
          (
            await f.complete({
              authorization: "Bearer valid",
              "x-store-id": randomUUID(),
            })
          ).statusCode,
        ).toBe(403);
        expect(send).not.toHaveBeenCalled();
        const response = await f.complete();
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          remoteUploadStatus: "CONFIRMED",
          sourceDocumentId: f.sourceDocumentId,
          jobId: f.sourceDocumentId,
        });
        expect(
          await f.db
            .collection("sourceDocuments")
            .findOne({ storeId: f.storeId }),
        ).toMatchObject({
          remoteUploadStatus: "CONFIRMED",
          checksum: f.input.checksum,
          objectKey: f.init.objectKey,
        });
        expect(
          await f.db
            .collection("commercialDocumentJobs")
            .findOne({ storeId: f.storeId }),
        ).toMatchObject({
          status: "PENDING",
          sourceDocumentId: f.sourceDocumentId,
          checksum: f.input.checksum,
        });
        expect(f.tasks).toHaveLength(1);
        finish({ ids: ["test"] });
        await f.tasks[0];
        await f.db
          .collection("commercialDocumentJobs")
          .updateOne(
            { storeId: f.storeId },
            { $set: { status: "PROCESSING" } },
          );
        send.mockResolvedValue({ ids: ["test"] });
        expect((await f.complete()).statusCode).toBe(200);
        await Promise.all(f.tasks);
        expect(
          await f.db
            .collection("commercialDocumentJobs")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(1);
        expect(
          await f.db
            .collection("commercialDocumentJobs")
            .findOne({ storeId: f.storeId }),
        ).toMatchObject({ status: "PROCESSING" });
        for (const [event] of send.mock.calls)
          expect(event).toEqual({
            id: `commercial-pdf.pages.v1:${f.sourceDocumentId}`,
            name: "commercial/pdf.uploaded",
            data: { storeId: f.storeId, sourceDocumentId: f.sourceDocumentId },
          });
      } finally {
        finish?.({ ids: [] });
        await Promise.all(f.tasks);
        await f.app.close();
        send.mockRestore();
      }
    });

    it("keeps a recoverable PENDING job when the dispatch provider fails, without marking the analysis successful", async () => {
      const send = vi
        .spyOn(Inngest.prototype, "send")
        .mockRejectedValue(Error("/signed?secret=private"));
      const f = await fixture();
      try {
        const response = await f.complete();
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain("private");
        await Promise.all(f.tasks);
        expect(
          await f.db
            .collection("commercialDocumentJobs")
            .findOne({ storeId: f.storeId }),
        ).toMatchObject({
          status: "PENDING",
          stage: "TEXT_EXTRACTION",
          attemptCount: 0,
        });
      } finally {
        await f.app.close();
        send.mockRestore();
      }
    });

    it("rejects mismatched blob and failed durable registration before any deferred dispatch, then recovers through completion retry", async () => {
      const send = vi
        .spyOn(Inngest.prototype, "send")
        .mockResolvedValue({ ids: ["test"] });
      const f = await fixture(true);
      try {
        blobHead.mockResolvedValueOnce({
          size: 1,
          contentType: "application/pdf",
        });
        expect((await f.complete()).json()).toMatchObject({
          remoteUploadStatus: "INVALID",
          jobId: null,
        });
        expect(f.tasks).toHaveLength(0);
        expect((await f.complete()).statusCode).toBe(500);
        expect(
          await f.db
            .collection("sourceDocuments")
            .findOne({ storeId: f.storeId }),
        ).toMatchObject({ remoteUploadStatus: "CONFIRMED" });
        expect(
          await f.db
            .collection("commercialDocumentJobs")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
        expect(f.tasks).toHaveLength(0);
        expect(send).not.toHaveBeenCalled();
        f.recoverQueue();
        expect((await f.complete()).json()).toMatchObject({
          remoteUploadStatus: "CONFIRMED",
          jobId: f.sourceDocumentId,
        });
        await Promise.all(f.tasks);
        expect(send).toHaveBeenCalledTimes(1);
      } finally {
        await f.app.close();
        send.mockRestore();
      }
    });
  },
);
