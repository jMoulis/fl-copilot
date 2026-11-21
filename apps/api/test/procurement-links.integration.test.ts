import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { procurementLinksFixture } from "../../../scripts/test-procurement-links-fixtures";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { runMongoMigrations } from "../src/database/migrations";
import { sourceObjectKey } from "../src/uploads/source-upload-service";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  type SyncPushRequest,
} from "@fl-copilot/sync-contracts";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "procurement link review canonical transaction",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = new MongoClient(uri!);
      await client.connect();
      db = client.db("fl_link_review_" + randomUUID().replaceAll("-", ""));
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
    async function setup() {
      const f = await procurementLinksFixture();
      await db.collection("storeMemberships").insertOne({
        storeId: f.config.storeId,
        userId: f.ownerId,
        active: true,
        role: "MANAGER",
      });
      const collection = (name: string) =>
        db.collection<Document & { _id: string }>(name);
      await collection("storeContextSettings").insertOne({
        _id: f.config.id,
        ...f.config,
      });
      await collection("procurementCatalogueSnapshots").insertOne({
        _id: f.snapshot.id,
        id: f.snapshot.id,
        storeId: f.snapshot.storeId,
        version: 1,
        publication: f.snapshot,
      });
      await collection("products").insertOne({
        _id: f.product.id,
        ...f.product,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
      });
      await collection("productIdentifiers").insertMany(
        f.identifiers.map((i) => ({
          _id: i.id,
          ...i,
          createdAt: new Date(i.createdAt),
          updatedAt: new Date(i.updatedAt),
        })),
      );
      const source = {
        sourceDocumentId: f.referenceId,
        sourceType: "MERCALYS_PURCHASE_PRICES" as const,
        filename: "ref.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
        sizeBytes: f.referenceBytes.length,
        checksum: f.referenceChecksum,
      };
      const key = sourceObjectKey(f.config.storeId, source);
      await collection("sourceDocuments").insertOne({
        _id: f.referenceId,
        ...source,
        id: f.referenceId,
        storeId: f.config.storeId,
        objectKey: key,
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      });
      await db.collection("sourceUploads").insertOne({
        ...source,
        storeId: f.config.storeId,
        objectKey: key,
        status: "CONFIRMED",
      });
      const review = await f.links.confirmBatch([f.link], f.context());
      const request: SyncPushRequest = {
        syncProtocolVersion: 1,
        appVersion: "test",
        procurementLinks: true,
        storeId: f.config.storeId,
        deviceId: f.publicationInput.deviceId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "PROCUREMENT_LINK_REVIEW_PUBLISH",
            entityType: "procurement_link_review",
            entityId: review!.id,
            expectedRemoteVersion: null,
            createdAt: review!.createdAt,
            payload: review,
          },
        ],
      };
      let bytes = f.referenceBytes,
        reads = 0;
      const push = createMongoSyncPushService(service(), () => new Date(), {
        read: async () => {
          reads++;
          return bytes;
        },
      });
      return {
        ...f,
        review: review!,
        request,
        push,
        reads: () => reads,
        corrupt: () => {
          bytes = new Uint8Array([0, 1, 2]);
        },
        send: () => push.push(request, randomUUID(), f.ownerId),
      };
    }
    it("publishes once, retains immutable audit and backfills review history only to opted-in clients", async () => {
      const f = await setup();
      try {
        const first = await f.send();
        expect(first.results[0]).toMatchObject({
          status: "APPLIED",
          remoteVersion: 1,
        });
        expect(f.reads()).toBe(1);
        expect((await f.send()).results[0]!.status).toBe("ALREADY_APPLIED");
        const retry = {
          ...f.request,
          commands: f.request.commands.map((c) => ({
            ...c,
            commandId: randomUUID(),
          })),
        };
        expect(
          (await f.push.push(retry, randomUUID(), f.ownerId)).results[0]!
            .status,
        ).toBe("APPLIED");
        expect(
          await db
            .collection("procurementProductLinks")
            .countDocuments({ storeId: f.config.storeId }),
        ).toBe(1);
        expect(
          await db
            .collection("procurementLinkReviews")
            .countDocuments({ storeId: f.config.storeId }),
        ).toBe(1);
        expect(
          await db
            .collection("products")
            .countDocuments({ storeId: f.config.storeId }),
        ).toBe(1);
        const bootstrap = await createMongoSyncBootstrapService(
          service(),
        ).bootstrap(
          {
            storeId: f.config.storeId,
            userId: f.ownerId,
            deviceId: f.publicationInput.deviceId,
            sessionId: randomUUID(),
            storeName: "Test",
            role: "MANAGER",
          },
          bootstrapQuerySchema.parse({ procurementLinks: "true" }),
        );
        const pull = createMongoSyncPullService(service());
        const page = await pull.pull(
          f.config.storeId,
          syncPullQuerySchema.parse({
            cursor: bootstrap.cursor,
            procurementLinks: "true",
          }),
          f.ownerId,
        );
        expect(page.procurementLinks).toBe(true);
        expect(
          page.changes.filter(
            (c) => c.entityType === "procurement_link_review",
          ),
        ).toHaveLength(1);
        const legacy = await pull.pull(
          f.config.storeId,
          syncPullQuerySchema.parse({ cursor: bootstrap.cursor }),
          f.ownerId,
        );
        expect(
          legacy.changes.filter(
            (c) => c.entityType === "procurement_link_review",
          ),
        ).toEqual([]);
      } finally {
        f.device.raw.close();
      }
    });
    it("retries missing reference uploads without consuming the decision and resumes the same command", async () => {
      const f = await setup();
      try {
        await db
          .collection("sourceUploads")
          .updateOne(
            { sourceDocumentId: f.referenceId },
            { $set: { status: "UPLOADING" } },
          );
        expect((await f.send()).results[0]).toMatchObject({
          status: "RETRYABLE_ERROR",
        });
        expect(
          await db
            .collection("procurementProductLinks")
            .countDocuments({ storeId: f.config.storeId }),
        ).toBe(0);
        await db
          .collection("sourceUploads")
          .updateOne(
            { sourceDocumentId: f.referenceId },
            { $set: { status: "CONFIRMED" } },
          );
        expect((await f.send()).results[0]!.status).toBe("APPLIED");
      } finally {
        f.device.raw.close();
      }
    });
    it("rejects altered source bytes and checks current ITM/EAN ownership before creating any link", async () => {
      const a = await setup();
      try {
        a.corrupt();
        expect((await a.send()).results[0]!.status).toBe("REJECTED");
        expect(
          await db
            .collection("procurementLinkReviews")
            .countDocuments({ storeId: a.config.storeId }),
        ).toBe(0);
      } finally {
        a.device.raw.close();
      }
      const b = await setup();
      try {
        await db
          .collection("productIdentifiers")
          .updateOne(
            { id: b.identifiers[1]!.id },
            { $set: { productId: randomUUID() } },
          );
        expect((await b.send()).results[0]!.status).toBe("CONFLICT");
        expect(
          await db
            .collection("procurementProductLinks")
            .countDocuments({ storeId: b.config.storeId }),
        ).toBe(0);
      } finally {
        b.device.raw.close();
      }
    });
    it("withdraws with an expected version and rejects a stale competing revision atomically", async () => {
      const f = await setup();
      try {
        expect((await f.send()).results[0]!.status).toBe("APPLIED");
        const withdrawal = {
          ...f.review,
          id: randomUUID(),
          decisions: [
            {
              expectedVersion: 1,
              link: { ...f.link, version: 2, status: "WITHDRAWN" },
            },
          ],
        };
        const req = {
          ...f.request,
          commands: [
            {
              ...f.request.commands[0]!,
              commandId: randomUUID(),
              entityId: withdrawal.id,
              payload: withdrawal,
            },
          ],
        };
        expect(
          (await f.push.push(req, randomUUID(), f.ownerId)).results[0]!.status,
        ).toBe("APPLIED");
        const stale = {
          ...req,
          commands: [
            {
              ...req.commands[0]!,
              commandId: randomUUID(),
              entityId: randomUUID(),
              payload: { ...withdrawal, id: randomUUID() },
            },
          ],
        };
        stale.commands[0]!.entityId = (
          stale.commands[0]!.payload as typeof withdrawal
        ).id;
        expect(
          (await f.push.push(stale, randomUUID(), f.ownerId)).results[0]!
            .status,
        ).toBe("CONFLICT");
        expect(
          await db
            .collection("procurementLinkReviews")
            .countDocuments({ storeId: f.config.storeId }),
        ).toBe(2);
        expect(
          await db
            .collection("procurementProductLinks")
            .findOne({ storeId: f.config.storeId }),
        ).toMatchObject({ version: 2, status: "WITHDRAWN" });
      } finally {
        f.device.raw.close();
      }
    });
    it("rejects an unauthorized actor and rolls back all choices if the final decision has no source generic", async () => {
      const f = await setup();
      try {
        await db
          .collection("storeMemberships")
          .updateOne(
            { storeId: f.config.storeId, userId: f.ownerId },
            { $set: { role: "COLLABORATOR" } },
          );
        expect((await f.send()).results[0]!.status).toBe("REJECTED");
        await db
          .collection("storeMemberships")
          .updateOne(
            { storeId: f.config.storeId, userId: f.ownerId },
            { $set: { role: "MANAGER" } },
          );
        const { procurementProductLinkId } =
          await import("../../mobile/src/products/procurement-links");
        const bad = {
          ...f.link,
          id: procurementProductLinkId(f.config.storeId, "999999"),
          genericId: "999999",
        };
        const body = {
          ...f.review,
          id: randomUUID(),
          decisions: [
            ...f.review.decisions,
            { expectedVersion: null, link: bad },
          ],
        };
        const req = {
          ...f.request,
          commands: [
            {
              ...f.request.commands[0]!,
              commandId: randomUUID(),
              entityId: body.id,
              payload: body,
            },
          ],
        };
        expect(
          (await f.push.push(req, randomUUID(), f.ownerId)).results[0]!.status,
        ).toBe("CONFLICT");
        expect(
          await db
            .collection("procurementProductLinks")
            .countDocuments({ storeId: f.config.storeId }),
        ).toBe(0);
        expect(
          await db
            .collection("procurementLinkReviews")
            .countDocuments({ storeId: f.config.storeId }),
        ).toBe(0);
      } finally {
        f.device.raw.close();
      }
    });
  },
);
