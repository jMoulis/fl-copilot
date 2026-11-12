import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { MongoClient, Decimal128 } from "mongodb";
import type { ProductDocument } from "../src/products/product-master";
import { DatabaseSync } from "node:sqlite";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { ProductMasterRepository } from "../../mobile/src/products/product-master-repository";
import { loadProductEditorSnapshot } from "../../mobile/src/products/product-editor-service";
import { assignCapturedVisual } from "../../mobile/src/products/visual-library-actions";
import {
  VisualLibraryRepository,
  applyVisualEntity,
} from "../../mobile/src/products/visual-library-repository";
import {
  visualFilePath,
  VisualFileCache,
} from "../../mobile/src/products/visual-file-cache";
import { createMongoSyncPushService } from "../src/sync/push-service";
import {
  createVisualFileService,
  type VisualFileStorage,
} from "../src/products/visual-file-service";
import { beforeAll, afterAll, it, expect, vi, describe } from "vitest";
import { visualLibraryFixture } from "../../../scripts/test-visual-library-fixtures";
import { alphaProductImageFixture } from "../../../scripts/test-product-image-fixtures";
import { createProductImageService } from "../src/products/product-image-service";
import { inspectGeneratedProductImage } from "../src/products/product-image-provider";
import {
  runMongoMigrations,
  mongoMigrations,
} from "../src/database/migrations";

describe.skipIf(!process.env.TEST_MONGODB_URI)(
  "product image generation durable request ledger",
  () => {
    const client = new MongoClient(
      process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27028",
    );
    const db = client.db(`fl_image_test_${randomUUID().replaceAll("-", "")}`);
    const database = {
      getDb: async () => db,
      checkHealth: async () => "connected" as const,
      close: async () => {},
    };
    beforeAll(async () => {
      await client.connect();
      await runMongoMigrations(db, mongoMigrations);
    });
    afterAll(async () => {
      await db.dropDatabase();
      await client.close();
    });
    async function setup() {
      const f = visualLibraryFixture();
      const { id, packaging: _packaging, ...base } = f.product;
      void _packaging;
      await db.collection<ProductDocument>("products").insertOne({
        ...base,
        _id: id,
        packaging: null,
        schemaVersion: 1,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
        deletedAt: null,
      });
      const bytes = await alphaProductImageFixture();
      const image = {
        ...(await inspectGeneratedProductImage(bytes)),
        provenance: {
          type: "AI_GENERATED" as const,
          provider: "TEST_FIXTURE_NOT_REAL_AI",
          model: "test",
          promptVersion: "test",
        },
      };
      const files = new Map<string, Uint8Array>();
      const provider = { generate: vi.fn(async () => ({ bytes, image })) };
      const storage = {
        writeImmutable: vi.fn(async (key: string, b: Uint8Array) => {
          files.set(key, b);
        }),
        read: vi.fn(async (key: string) => files.get(key) ?? null),
      };
      const policy = { enabled: true, model: "test", estimatedCostUsd: 0.03 };
      const service = createProductImageService(
        database,
        policy,
        provider,
        storage,
      );
      const ctx = { storeId: f.storeId, userId: f.actorId, role: "MANAGER" };
      const quote = await service.options(ctx, f.product.id);
      const input = {
        requestId: randomUUID(),
        productId: f.product.id,
        productVersion: f.product.version,
        policyId: quote.policyId,
      };
      return {
        f,
        bytes,
        image,
        provider,
        storage,
        policy,
        service,
        ctx,
        input,
      };
    }
    it("reads canonical BSON IDs, dates and Decimal128 packaging before constructing the image prompt", async () => {
      const s = await setup();
      await db.collection<ProductDocument>("products").updateOne(
        { _id: s.f.product.id },
        {
          $set: {
            nature: "PACKAGED",
            packaging: {
              quantity: Decimal128.fromString("250"),
              unit: "G",
              sourceLabel: "barquette 250 g",
            },
          },
        },
      );
      expect((await s.service.options(s.ctx, s.f.product.id)).available).toBe(
        true,
      );
      expect((await s.service.generate(s.ctx, s.input)).status).toBe("READY");
      expect(s.provider.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: s.f.product.id,
          createdAt: s.f.product.createdAt,
          nature: "PACKAGED",
          packaging: {
            quantity: "250",
            unit: "G",
            sourceLabel: "barquette 250 g",
          },
        }),
      );
    });
    it("carries an explicitly chosen generated PNG through canonical sync and visual-file manifests to another local device", async () => {
      const s = await setup();
      const generation = await s.service.generate(s.ctx, s.input);
      expect(generation.status).toBe("READY");
      const local = new VisualTestDatabase(new DatabaseSync(":memory:")),
        second = new VisualTestDatabase(new DatabaseSync(":memory:"));
      try {
        await runLocalMigrations(local);
        await runLocalMigrations(second);
        const products = new ProductMasterRepository(local),
          lib = new VisualLibraryRepository(local);
        await products.upsertProduct(s.f.product, {
          commandId: randomUUID(),
          deviceId: s.f.deviceId,
        });
        const asset = await assignCapturedVisual(
          local,
          {
            product: (await loadProductEditorSnapshot(
              products,
              s.f.product.id,
            ))!,
            link: null,
          },
          {
            ...generation.image!,
            relativePath: visualFilePath(
              s.ctx.storeId,
              "SOURCE",
              "image/png",
              generation.image!.contentHash,
            ),
          },
          true,
          {
            storeId: s.ctx.storeId,
            actorId: s.ctx.userId,
            deviceId: s.f.deviceId,
            id: randomUUID,
            now: () => s.f.at,
            canWrite: () => true,
          },
          generation.image!,
        );
        await db.collection("storeMemberships").insertOne({
          storeId: s.ctx.storeId,
          userId: s.ctx.userId,
          active: true,
          role: "MANAGER",
        });
        const entities = await Promise.all(
          (
            ["visual_asset", "visual_identity", "product_visual_link"] as const
          ).map(async (kind) => ({
            kind,
            entity: (await lib.list(kind, s.ctx.storeId))[0]!.entity,
          })),
        );
        const push = await createMongoSyncPushService(database).push(
          {
            syncProtocolVersion: 1,
            appVersion: "test",
            storeId: s.ctx.storeId,
            deviceId: s.f.deviceId,
            commands: entities.map(({ kind, entity }, i) => ({
              commandId: randomUUID(),
              entityType: kind,
              type: `${kind.toUpperCase()}_UPSERT`,
              entityId: entity.id,
              localSequence: i + 1,
              expectedRemoteVersion: null,
              createdAt: s.f.at,
              payload: entity,
            })),
          },
          "test-generated-image",
          s.ctx.userId,
        );
        expect(push.results.map((r) => r.status)).toEqual([
          "APPLIED",
          "APPLIED",
          "APPLIED",
        ]);
        const files = new Map<string, Uint8Array>();
        let stage = "";
        const storage: VisualFileStorage = {
          uploadUrl: async (key) => {
            stage = key;
            return `https://example.test/${key}`;
          },
          writeImmutable: async (key, b) => {
            files.set(key, b);
          },
          read: async (key) => files.get(key) ?? null,
          removeStaging: async (key) => {
            files.delete(key);
          },
        };
        const canonical = createVisualFileService(database, storage);
        const init = await canonical.init(s.ctx, asset.id);
        files.set(stage, s.bytes);
        await canonical.complete(s.ctx, asset.id, init.uploadId!);
        const manifest = await canonical.manifest(s.ctx, asset.id, true);
        expect(manifest.processorVersion).toBe("visual-image.v2");
        expect(manifest.preview.mimeType).toBe("image/png");
        const preview = await canonical.read(s.ctx, asset.id, "preview", true);
        expect(
          (await inspectGeneratedProductImage(preview.bytes)).mimeType,
        ).toBe("image/png");
        for (const { kind, entity } of entities)
          await applyVisualEntity(second, s.ctx.storeId, kind, entity);
        await new VisualFileCache(second).remember(
          s.ctx.storeId,
          asset.id,
          "PREVIEW",
          {
            ...manifest.preview,
            relativePath: visualFilePath(
              s.ctx.storeId,
              "PREVIEW",
              "image/png",
              manifest.preview.contentHash,
            ),
          },
          manifest,
        );
        const display = await new VisualLibraryRepository(second).resolve(
          s.f.product,
        );
        expect(display.kind).toBe("ASSET");
        if (display.kind === "ASSET") expect(display.illustrative).toBe(true);
        expect((await canonical.read(s.ctx, asset.id, "source")).bytes).toEqual(
          s.bytes,
        );
      } finally {
        local.raw.close();
        second.raw.close();
      }
    });
    it("does not approve or change a product during generation; replays a finished request without another provider call", async () => {
      const s = await setup();
      const first = await s.service.generate(s.ctx, s.input);
      expect(first.status).toBe("READY");
      expect(await s.service.generate(s.ctx, s.input)).toEqual(first);
      expect(s.provider.generate).toHaveBeenCalledTimes(1);
      expect(await s.service.file(s.ctx, s.input.requestId)).toEqual(s.bytes);
      expect(
        await db
          .collection("visualAssets")
          .countDocuments({ storeId: s.ctx.storeId }),
      ).toBe(0);
      expect(
        await db
          .collection("productVisualLinks")
          .countDocuments({ storeId: s.ctx.storeId }),
      ).toBe(0);
      await expect(
        s.service.status({ ...s.ctx, userId: randomUUID() }, s.input.requestId),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        s.service.status(
          { ...s.ctx, storeId: randomUUID() },
          s.input.requestId,
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        s.service.status({ ...s.ctx, role: "MEMBER" }, s.input.requestId),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        s.service.generate(s.ctx, { ...s.input, productVersion: 12 }),
      ).rejects.toThrow();
    });
    it("atomically deduplicates parallel requests and enforces one running image per store", async () => {
      const s = await setup();
      let complete!: () => void;
      const gate = new Promise<void>((resolve) => {
        complete = resolve;
      });
      s.provider.generate.mockImplementationOnce(async () => {
        await gate;
        return { bytes: s.bytes, image: s.image };
      });
      const first = s.service.generate(s.ctx, s.input);
      await vi.waitFor(() =>
        expect(s.provider.generate).toHaveBeenCalledTimes(1),
      );
      expect((await s.service.generate(s.ctx, s.input)).status).toBe("RUNNING");
      await expect(
        s.service.generate(s.ctx, { ...s.input, requestId: randomUUID() }),
      ).rejects.toMatchObject({ publicCode: "PRODUCT_IMAGE_BUSY" });
      complete();
      await first;
      expect(s.provider.generate).toHaveBeenCalledTimes(1);
    });
    it("retains billed rejected output and reports its cause without regenerating or serving it", async () => {
      const s = await setup();
      const bytes = await sharp(s.bytes)
        .flatten({ background: "white" })
        .png()
        .toBuffer();
      const provider = {
        generate: vi.fn(async () => ({
          bytes,
          image: s.image,
          usage: { inputTokens: 100, outputTokens: 1758 },
        })),
      };
      const service = createProductImageService(
        database,
        s.policy,
        provider,
        s.storage,
      );
      const reject = { publicCode: "PRODUCT_IMAGE_INVALID", statusCode: 422 };
      await expect(service.generate(s.ctx, s.input)).rejects.toMatchObject(
        reject,
      );
      await expect(
        service.status(s.ctx, s.input.requestId),
      ).rejects.toMatchObject(reject);
      await expect(service.generate(s.ctx, s.input)).rejects.toMatchObject(
        reject,
      );
      expect(provider.generate).toHaveBeenCalledTimes(1);
      expect(s.storage.writeImmutable).toHaveBeenCalledWith(
        expect.any(String),
        bytes,
        "image/png",
      );
      expect(
        await db
          .collection("productImageGenerations")
          .findOne({ _id: s.input.requestId } as never),
      ).toMatchObject({
        status: "UNKNOWN",
        image: null,
        failureStage: "VALIDATION",
        failureCode: "PRODUCT_IMAGE_INVALID",
        providerUsage: { outputTokens: 1758 },
      });
      await expect(
        service.file(s.ctx, s.input.requestId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
    it("keeps an uncertain or expired outcome without automatically charging a second attempt", async () => {
      const s = await setup();
      s.provider.generate.mockRejectedValueOnce(
        Error("potentially billed provider failure"),
      );
      expect((await s.service.generate(s.ctx, s.input)).status).toBe("UNKNOWN");
      expect((await s.service.generate(s.ctx, s.input)).status).toBe("UNKNOWN");
      expect(s.provider.generate).toHaveBeenCalledTimes(1);
      await db
        .collection("productImageGenerations")
        .updateOne({ _id: s.input.requestId } as never, {
          $set: { status: "RUNNING", createdAt: new Date(0) },
        });
      expect((await s.service.status(s.ctx, s.input.requestId)).status).toBe(
        "UNKNOWN",
      );
      expect(s.provider.generate).toHaveBeenCalledTimes(1);
    });
    it("blocks changed products, stale costs and disabled generation before spending", async () => {
      const s = await setup();
      await expect(
        s.service.generate(s.ctx, { ...s.input, policyId: "stale" }),
      ).rejects.toThrow();
      await expect(
        s.service.generate(s.ctx, { ...s.input, productVersion: 99 }),
      ).rejects.toThrow();
      const disabled = createProductImageService(
        database,
        { ...s.policy, enabled: false },
        s.provider,
        s.storage,
      );
      expect((await disabled.options(s.ctx, s.input.productId)).available).toBe(
        false,
      );
      await expect(disabled.generate(s.ctx, s.input)).rejects.toThrow();
      expect(s.provider.generate).not.toHaveBeenCalled();
    });
  },
);
