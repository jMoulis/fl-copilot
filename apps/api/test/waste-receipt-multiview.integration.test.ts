import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  RECEIPT_PHOTO_BUNDLE_MIME,
  RECEIPT_PHOTO_BUNDLE_VERSION,
  serializeReceiptPhotoBundle,
  type ReceiptPhotoBundle,
} from "@fl-copilot/domain";
import {
  completeSourceUploadResponseSchema,
  type InitSourceUploadRequest,
} from "@fl-copilot/sync-contracts";
import { parseEnvironment } from "../src/config";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { createMongoSourceUploadService } from "../src/uploads/source-upload-service";
import {
  createMongoWasteReceiptImageNormalizationService,
  sharpReceiptImageAdapter,
  type ReceiptImageStorage,
} from "../src/uploads/waste-receipt-image-normalization";
import { createMongoWasteReceiptVisionExtractionService } from "../src/uploads/waste-receipt-vision-extraction";
import { createMongoWasteReceiptArithmeticValidationService } from "../src/uploads/waste-receipt-arithmetic-validation";
import { createMongoWasteReceiptProductMatchingService } from "../src/uploads/waste-receipt-product-matching";
import { createMongoWasteReceiptDraftReader } from "../src/uploads/waste-receipt-draft";
import {
  receiptBytesChecksum,
  receiptViewDerivativeObjectKey,
} from "../src/uploads/receipt-photo-bundle";
import {
  MAX_RECEIPT_MULTIVIEW_ATTEMPTS,
  WASTE_RECEIPT_MULTIVIEW_SCHEMA_VERSION,
} from "../src/uploads/waste-receipt-multiview-extraction";

const uri = process.env.TEST_MONGODB_URI;
const line = {
  sourceLineIndex: 0,
  rawLabel: "BANANE VRAC",
  quantity: null,
  weight: 1.2,
  quantityUnit: "kg",
  unitPrice: 2,
  totalPrice: 2.4,
  extractionConfidence: {
    label: 0.99,
    quantity: 0.95,
    unitPrice: 0.97,
    totalPrice: 0.98,
  },
  sourceRegion: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
  sourceImageIndexes: [0, 1],
};
const validOutput = {
  singleReceipt: true,
  overlapResolved: true,
  detectedReceiptDate: "2026-10-17",
  cashierNumber: "0000123",
  cashierNumberConfidence: 0.96,
  cashierNumberRegion: { x: 0.1, y: 0.9, width: 0.6, height: 0.05 },
  cashierImageIndex: 1,
  // Two genuine identical occurrences, despite overlap. Neither is collapsed by a text heuristic.
  lines: [
    line,
    {
      ...line,
      sourceLineIndex: 1,
      sourceImageIndexes: [1],
      sourceRegion: { ...line.sourceRegion, y: 0.5 },
    },
  ],
};

describe.skipIf(!uri)(
  "one long receipt: immutable originals, bounded multi-view analysis and canonical draft",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_mv_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      if (database) {
        await (await database.getDb()).dropDatabase();
        await database.close();
      }
    });
    async function fixture() {
      const storeId = randomUUID(),
        sourceDocumentId = randomUUID(),
        userId = randomUUID();
      const originals = await Promise.all(
        ["#ffffff", "#cccccc"].map((background) =>
          sharp({ create: { width: 64, height: 120, channels: 3, background } })
            .png()
            .toBuffer(),
        ),
      );
      const bundle: ReceiptPhotoBundle = {
        schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
        mode: "ONE_RECEIPT_MULTIPLE_PHOTOS" as const,
        views: originals.map((image) => ({
          mimeType: "image/png" as const,
          sizeBytes: image.length,
          checksum: receiptBytesChecksum(image),
          dataBase64: image.toString("base64"),
        })),
      };
      const bytes = Buffer.from(serializeReceiptPhotoBundle(bundle)),
        checksum = receiptBytesChecksum(bytes);
      const blobs = new Map<string, Uint8Array>(),
        db = await database.getDb();
      const c = (name: string) =>
        db.collection<{ _id: string; [key: string]: unknown }>(name);
      let time = new Date("2026-10-18T12:00:00Z");
      const now = () => time;
      const storage: ReceiptImageStorage = {
        read: vi.fn(async (key) => blobs.get(key) ?? null),
        write: vi.fn(async (key, image) => {
          blobs.set(key, image.slice());
          return {
            pathname: key,
            url: "https://private.example/derivative",
            etag: receiptBytesChecksum(image),
          };
        }),
      };
      const normalize = vi.fn(sharpReceiptImageAdapter.normalize);
      const normalizer = createMongoWasteReceiptImageNormalizationService(
        database,
        storage,
        now,
        { normalize },
      );
      const extractViews = vi.fn(
        async (
          _images: readonly Uint8Array[],
        ): Promise<{ output: unknown; responseId: string; model: string }> => {
          expect(_images).toHaveLength(2);
          return {
            output: structuredClone(validOutput),
            responseId: "mock-response",
            model: "mock-vision-resolved",
          };
        },
      );
      const singleExtract = vi.fn(async () => {
        throw new Error("single-photo adapter must not be called");
      });
      const vision = createMongoWasteReceiptVisionExtractionService(
        database,
        {
          provider: "mock",
          model: "mock-vision",
          extract: singleExtract,
          extractViews,
        },
        storage,
        now,
      );
      const service = createMongoSourceUploadService(
        database,
        {
          createUploadUrl: async () => "https://upload.example/private",
          head: async (key) => {
            const image = blobs.get(key);
            return image
              ? {
                  pathname: key,
                  contentType: RECEIPT_PHOTO_BUNDLE_MIME,
                  size: image.length,
                  url: "https://private.example/original",
                  etag: receiptBytesChecksum(image),
                }
              : null;
          },
        },
        now,
        normalizer,
        vision,
        createMongoWasteReceiptArithmeticValidationService(
          database,
          "0.02",
          now,
        ),
        createMongoWasteReceiptProductMatchingService(
          database,
          {
            load: async () => ({ products: [], aliases: [], identifiers: [] }),
          },
          now,
        ),
        createMongoWasteReceiptDraftReader(database),
      );
      const initInput: InitSourceUploadRequest = {
        sourceDocumentId,
        sourceType: "WASTE_RECEIPT" as const,
        filename: "ticket.flreceipt",
        mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
        sizeBytes: bytes.length,
        checksum,
      };
      const upload = await service.init(storeId, userId, initInput);
      blobs.set(upload.objectKey, new Uint8Array(bytes));
      const complete = () =>
        service.complete(storeId, upload.uploadId, {
          sizeBytes: bytes.length,
          checksum,
        });
      // Confirm original without invoking vision to exercise worker boundaries directly.
      const prepare = async () => {
        await c("sourceDocuments").updateOne(
          { _id: sourceDocumentId, storeId },
          { $set: { remoteUploadStatus: "CONFIRMED" } },
        );
        await normalizer.normalize({
          storeId,
          sourceDocumentId,
          sourceObjectKey: upload.objectKey,
        });
      };
      return {
        storeId,
        sourceDocumentId,
        userId,
        originals,
        bundle,
        bytes,
        checksum,
        blobs,
        c,
        storage,
        normalize,
        normalizer,
        vision,
        extractViews,
        singleExtract,
        service,
        initInput,
        upload,
        complete,
        prepare,
        setTime: (value: Date) => {
          time = value;
        },
        extract: () => vision.extract({ storeId, sourceDocumentId }),
      };
    }
    it("reads all originals separately, extracts once across overlap, preserves repeated occurrences and returns an unpublished canonical draft after replay", async () => {
      const f = await fixture(),
        first = await f.complete(),
        second = await f.complete();
      expect(completeSourceUploadResponseSchema.parse(first)).toEqual(
        completeSourceUploadResponseSchema.parse(second),
      );
      expect(first.wasteReceiptDraft).toMatchObject({
        detectedReceiptDate: "2026-10-17",
        detectedCashierNumber: "0000123",
      });
      expect(first.wasteReceiptDraft?.lines).toHaveLength(2);
      expect(first.wasteReceiptDraft?.lines[0]).toMatchObject({
        weight: "1.2",
        totalPrice: "2.4",
        arithmeticStatus: "CONSISTENT",
        sourceRegion: { imageIndexes: [0, 1], region: line.sourceRegion },
      });
      expect(first.wasteReceiptDraft?.lines[0]?.lineId).not.toBe(
        first.wasteReceiptDraft?.lines[1]?.lineId,
      );
      expect(f.extractViews).toHaveBeenCalledTimes(1);
      expect(f.singleExtract).not.toHaveBeenCalled();
      expect(f.normalize).toHaveBeenCalledTimes(2);
      expect(f.normalize.mock.calls.map(([image]) => image)).toEqual(
        f.originals.map((image) => new Uint8Array(image)),
      );
      expect(f.blobs.get(f.upload.objectKey)).toEqual(new Uint8Array(f.bytes));
      expect(
        await f.c("sourceDocuments").findOne({ _id: f.sourceDocumentId }),
      ).toMatchObject({
        checksum: f.checksum,
        normalizationStatus: "READY",
        extractionStatus: "READY",
        extractionSchemaVersion: WASTE_RECEIPT_MULTIVIEW_SCHEMA_VERSION,
        groupVisionAttemptCount: 1,
      });
      expect(
        await f
          .c("wasteReceiptExtractions")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
      expect(
        await f.c("wasteObservations").countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    });
    it("fences concurrent completions and reuses durable evidence after response loss", async () => {
      const f = await fixture();
      await f.prepare();
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.extractViews.mockImplementationOnce(async () => {
        await wait;
        return { output: validOutput, responseId: "once", model: "mock" };
      });
      const first = f.extract();
      await vi.waitFor(() => expect(f.extractViews).toHaveBeenCalledTimes(1));
      await expect(f.extract()).rejects.toThrow(
        "WASTE_RECEIPT_MULTIVIEW_PROCESSING",
      );
      release();
      await first;
      await f
        .c("sourceDocuments")
        .updateOne(
          { _id: f.sourceDocumentId },
          { $set: { extractionStatus: "EXTRACTING", extractionId: null } },
        );
      await f.extract();
      expect(f.extractViews).toHaveBeenCalledTimes(1);
      expect(
        await f
          .c("wasteReceiptExtractions")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
    });
    it("does not let a stale slow response replace the later lease owner's result", async () => {
      const f = await fixture();
      await f.prepare();
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.extractViews.mockImplementationOnce(async () => {
        await wait;
        return {
          output: { ...validOutput, cashierNumber: "000stale" },
          responseId: "stale",
          model: "mock",
        };
      });
      const first = f.extract().catch((error) => error);
      await vi.waitFor(() => expect(f.extractViews).toHaveBeenCalledTimes(1));
      f.setTime(new Date("2026-10-18T12:04:00Z"));
      await f.extract();
      release();
      expect((await first).publicCode).toBe(
        "WASTE_RECEIPT_MULTIVIEW_PROCESSING",
      );
      const extraction = await f
        .c("wasteReceiptExtractions")
        .findOne({ storeId: f.storeId });
      expect(extraction?.output).toMatchObject({ cashierNumber: "0000123" });
      expect(
        await f.c("sourceDocuments").findOne({ _id: f.sourceDocumentId }),
      ).toMatchObject({
        extractionStatus: "READY",
        groupVisionAttemptCount: 2,
      });
    });
    it.each([
      "mixed",
      "overlap",
      "invalidIndex",
      "duplicateEvidence",
      "duplicateLineIndex",
    ])(
      "stops %s for review instead of repeating paid analysis or creating draft lines",
      async (mode) => {
        const f = await fixture();
        await f.prepare();
        const output = structuredClone(validOutput);
        if (mode === "mixed") output.singleReceipt = false;
        if (mode === "overlap") output.overlapResolved = false;
        if (mode === "invalidIndex") output.lines[0]!.sourceImageIndexes = [4];
        if (mode === "duplicateEvidence")
          output.lines[0]!.sourceImageIndexes = [0, 0];
        if (mode === "duplicateLineIndex") output.lines[1]!.sourceLineIndex = 0;
        f.extractViews.mockResolvedValue({
          output,
          responseId: "ambiguous",
          model: "mock",
        });
        for (let i = 0; i < 2; i++)
          await expect(f.extract()).rejects.toThrow(
            "WASTE_RECEIPT_MULTIVIEW_REVIEW_REQUIRED",
          );
        expect(f.extractViews).toHaveBeenCalledTimes(1);
        expect(
          await f
            .c("wasteReceiptExtractions")
            .countDocuments({ storeId: f.storeId }),
        ).toBe(0);
        expect(f.blobs.get(f.upload.objectKey)).toEqual(
          new Uint8Array(f.bytes),
        );
      },
    );
    it("caps transient failures durably across new service instances without exposing provider text", async () => {
      const f = await fixture();
      await f.prepare();
      f.extractViews.mockRejectedValue(new Error("secret provider payload"));
      for (let i = 0; i < MAX_RECEIPT_MULTIVIEW_ATTEMPTS; i++)
        await expect(f.extract()).rejects.toThrow(
          "WASTE_RECEIPT_MULTIVIEW_FAILED",
        );
      await expect(f.extract()).rejects.toThrow(
        "WASTE_RECEIPT_MULTIVIEW_ATTEMPTS_EXHAUSTED",
      );
      expect(f.extractViews).toHaveBeenCalledTimes(
        MAX_RECEIPT_MULTIVIEW_ATTEMPTS,
      );
      expect(
        await f.c("sourceDocuments").findOne({ _id: f.sourceDocumentId }),
      ).toMatchObject({
        groupVisionAttemptCount: MAX_RECEIPT_MULTIVIEW_ATTEMPTS,
        extractionFailureCode: "WASTE_RECEIPT_MULTIVIEW_FAILED",
      });
    });
    it("checks derivative bytes and store/source ownership before a model call", async () => {
      const f = await fixture();
      await f.prepare();
      await expect(
        f.vision.extract({
          storeId: randomUUID(),
          sourceDocumentId: f.sourceDocumentId,
        }),
      ).rejects.toThrow("WASTE_RECEIPT_NORMALIZED_SOURCE_NOT_READY");
      f.blobs.set(
        receiptViewDerivativeObjectKey(f.storeId, f.sourceDocumentId, 1),
        new Uint8Array([5]),
      );
      await expect(f.extract()).rejects.toThrow(
        "WASTE_RECEIPT_MULTIVIEW_DERIVATIVE_INVALID",
      );
      expect(f.extractViews).not.toHaveBeenCalled();
    });
    it("rejects a tampered original before writing any derivative or calling vision", async () => {
      const f = await fixture();
      const json = JSON.parse(f.bytes.toString());
      json.views[0].checksum = `sha256:${"a".repeat(64)}`;
      const bytes = Buffer.from(JSON.stringify(json));
      f.blobs.set(f.upload.objectKey, bytes);
      await f.c("sourceDocuments").updateOne(
        { _id: f.sourceDocumentId },
        {
          $set: {
            remoteUploadStatus: "CONFIRMED",
            checksum: receiptBytesChecksum(bytes),
            sizeBytes: bytes.length,
          },
        },
      );
      await expect(
        f.normalizer.normalize({
          storeId: f.storeId,
          sourceDocumentId: f.sourceDocumentId,
          sourceObjectKey: f.upload.objectKey,
        }),
      ).rejects.toThrow("WASTE_RECEIPT_PHOTO_BUNDLE_INVALID");
      expect(f.normalize).not.toHaveBeenCalled();
      expect(f.storage.write).not.toHaveBeenCalled();
      expect(f.extractViews).not.toHaveBeenCalled();
    });
    it("marks normalization ready only after every view; retries partial derivative writes without losing originals", async () => {
      const f = await fixture();
      f.normalize
        .mockImplementationOnce(sharpReceiptImageAdapter.normalize)
        .mockRejectedValueOnce(new Error("normalization unavailable"));
      await expect(f.complete()).rejects.toThrow("normalization unavailable");
      expect(
        await f.c("sourceDocuments").findOne({ _id: f.sourceDocumentId }),
      ).toMatchObject({ normalizationStatus: "FAILED" });
      expect(f.extractViews).not.toHaveBeenCalled();
      await f.complete();
      expect(f.extractViews).toHaveBeenCalledTimes(1);
      expect(f.blobs.get(f.upload.objectKey)).toEqual(new Uint8Array(f.bytes));
    });
    it("recognizes the same ordered group under another filename and skips a second model call", async () => {
      const f = await fixture();
      await f.complete();
      f.setTime(new Date("2026-10-18T12:01:00Z"));
      const input = {
        ...f.initInput,
        sourceDocumentId: randomUUID(),
        filename: "renamed.flreceipt",
      };
      const upload = await f.service.init(f.storeId, f.userId, input);
      f.blobs.set(upload.objectKey, new Uint8Array(f.bytes));
      const result = await f.service.complete(f.storeId, upload.uploadId, {
        checksum: f.checksum,
        sizeBytes: f.bytes.length,
      });
      expect(result.wasteReceiptDuplicate).toMatchObject({
        status: "POSSIBLE_DUPLICATE",
        candidateSourceDocumentId: f.sourceDocumentId,
      });
      expect(result.wasteReceiptDraft?.lines).toHaveLength(2);
      expect(f.extractViews).toHaveBeenCalledTimes(1);
    });
    it("reuses completed immutable evidence after provider configuration changes instead of paying again", async () => {
      const f = await fixture();
      await f.complete();
      const extractViews = vi.fn(async () => {
        throw Error("must not call another model");
      });
      const changed = createMongoWasteReceiptVisionExtractionService(
        database,
        {
          provider: "changed-provider",
          model: "changed-model",
          extract: f.singleExtract,
          extractViews,
        },
        f.storage,
      );
      await changed.extract({
        storeId: f.storeId,
        sourceDocumentId: f.sourceDocumentId,
      });
      expect(extractViews).not.toHaveBeenCalled();
      expect(
        await f
          .c("wasteReceiptExtractions")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
    });
    it("preserves the pending model and attempt budget across configuration changes", async () => {
      const f = await fixture();
      await f.prepare();
      f.extractViews.mockRejectedValue(new Error("temporary provider failure"));
      await expect(f.extract()).rejects.toThrow(
        "WASTE_RECEIPT_MULTIVIEW_FAILED",
      );
      const extractViews = vi.fn(async () => {
        throw Error("must not call another model");
      });
      const changed = createMongoWasteReceiptVisionExtractionService(
        database,
        {
          provider: "changed-provider",
          model: "changed-model",
          extract: f.singleExtract,
          extractViews,
        },
        f.storage,
      );
      await expect(
        changed.extract({
          storeId: f.storeId,
          sourceDocumentId: f.sourceDocumentId,
        }),
      ).rejects.toThrow("WASTE_RECEIPT_MULTIVIEW_MODEL_CHANGED");
      expect(extractViews).not.toHaveBeenCalled();
      expect(
        await f.c("sourceDocuments").findOne({ _id: f.sourceDocumentId }),
      ).toMatchObject({
        groupVisionAttemptCount: 1,
        groupVisionModel: "mock-vision",
      });
    });
  },
);
