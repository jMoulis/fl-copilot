import { randomUUID } from "node:crypto";
import {
  BlobNotFoundError,
  head,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";
import type {
  CompleteSourceUploadRequest,
  CompleteSourceUploadResponse,
  InitSourceUploadRequest,
  InitSourceUploadResponse,
  WasteReceiptDraft,
} from "@fl-copilot/sync-contracts";
import { AuthError } from "../auth/service.js";
import type { DatabaseService } from "../database/types.js";
import {
  createMongoWasteReceiptImageNormalizationService,
  type WasteReceiptImageNormalizationService,
} from "./waste-receipt-image-normalization.js";
import type { WasteReceiptArithmeticValidationService } from "./waste-receipt-arithmetic-validation.js";
import type { WasteReceiptDraftReader } from "./waste-receipt-draft.js";
import type { WasteReceiptProductMatchingService } from "./waste-receipt-product-matching.js";
import type { WasteReceiptVisionExtractionService } from "./waste-receipt-vision-extraction.js";

const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;

export interface SourceBlobMetadata {
  pathname: string;
  size: number;
  contentType: string;
  url: string;
  etag: string;
}

export interface SourceBlobStorage {
  createUploadUrl(input: {
    pathname: string;
    contentType: string;
    maximumSizeInBytes: number;
    validUntil: number;
  }): Promise<string>;
  head(pathname: string): Promise<SourceBlobMetadata | null>;
}

export interface SourceUploadService {
  init(
    storeId: string,
    userId: string,
    input: InitSourceUploadRequest,
  ): Promise<InitSourceUploadResponse>;
  complete(
    storeId: string,
    uploadId: string,
    input: CompleteSourceUploadRequest,
  ): Promise<CompleteSourceUploadResponse>;
}

type UploadRecord = {
  _id: string;
  storeId: string;
  userId: string;
  sourceDocumentId: string;
  sourceType: InitSourceUploadRequest["sourceType"];
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  objectKey: string;
  status: "PENDING" | "CONFIRMED" | "INVALID";
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  blob?: SourceBlobMetadata;
};

type RemoteSourceDocumentRecord = {
  _id: string;
  storeId: string;
  sourceType: InitSourceUploadRequest["sourceType"];
  originalFilename: string;
  checksum: string;
  sizeBytes: number;
  mimeType: string;
  remoteUploadStatus: "PENDING" | "CONFIRMED" | "INVALID";
  objectKey: string;
  blobUrl?: string;
  blobEtag?: string;
  createdAt: Date;
  updatedAt: Date;
};

export function createVercelSourceBlobStorage(): SourceBlobStorage {
  return {
    async createUploadUrl(input) {
      const token = await issueSignedToken({
        pathname: input.pathname,
        operations: ["put"],
        allowedContentTypes: [input.contentType],
        maximumSizeInBytes: input.maximumSizeInBytes,
        validUntil: input.validUntil,
      });
      const { presignedUrl } = await presignUrl(token, {
        operation: "put",
        pathname: input.pathname,
        access: "private",
        allowedContentTypes: [input.contentType],
        maximumSizeInBytes: input.maximumSizeInBytes,
        validUntil: input.validUntil,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return presignedUrl;
    },
    async head(pathname) {
      try {
        const blob = await head(pathname);
        return {
          pathname: blob.pathname,
          size: blob.size,
          contentType: blob.contentType,
          url: blob.url,
          etag: blob.etag,
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
  };
}

export function createMongoSourceUploadService(
  database: DatabaseService,
  storage: SourceBlobStorage = createVercelSourceBlobStorage(),
  now: () => Date = () => new Date(),
  receiptImages: WasteReceiptImageNormalizationService = createMongoWasteReceiptImageNormalizationService(
    database,
  ),
  receiptVision?: WasteReceiptVisionExtractionService,
  receiptArithmetic?: WasteReceiptArithmeticValidationService,
  receiptProductMatching?: WasteReceiptProductMatchingService,
  receiptDrafts?: WasteReceiptDraftReader,
): SourceUploadService {
  return {
    async init(storeId, userId, input) {
      const db = await database.getDb();
      const uploads = db.collection<UploadRecord>("sourceUploads");
      let upload = await uploads.findOne({
        storeId,
        sourceDocumentId: input.sourceDocumentId,
      });

      if (upload) {
        assertSameUpload(upload, input);
      } else {
        const timestamp = now();
        const created: UploadRecord = {
          _id: randomUUID(),
          storeId,
          userId,
          sourceDocumentId: input.sourceDocumentId,
          sourceType: input.sourceType,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          objectKey: sourceObjectKey(storeId, input),
          status: "PENDING",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        try {
          await uploads.insertOne(created);
          upload = created;
          await db
            .collection<RemoteSourceDocumentRecord>("sourceDocuments")
            .updateOne(
              { _id: input.sourceDocumentId, storeId },
              {
                $setOnInsert: {
                  _id: input.sourceDocumentId,
                  storeId,
                  sourceType: input.sourceType,
                  originalFilename: input.filename,
                  checksum: input.checksum,
                  sizeBytes: input.sizeBytes,
                  mimeType: input.mimeType,
                  remoteUploadStatus: "PENDING",
                  objectKey: created.objectKey,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                },
              },
              { upsert: true },
            );
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          upload = await uploads.findOne({
            storeId,
            sourceDocumentId: input.sourceDocumentId,
          });
          if (!upload) throw error;
          assertSameUpload(upload, input);
        }
      }

      if (upload.status === "CONFIRMED") return alreadyUploaded(upload);

      const existingBlob = await storage.head(upload.objectKey);
      if (existingBlob) {
        assertBlobMatches(upload, existingBlob);
        await confirmUpload(database, upload, existingBlob, now());
        return alreadyUploaded(upload);
      }

      const validUntil = now().getTime() + UPLOAD_URL_TTL_MS;
      const uploadUrl = await storage.createUploadUrl({
        pathname: upload.objectKey,
        contentType: upload.mimeType,
        maximumSizeInBytes: upload.sizeBytes,
        validUntil,
      });
      return {
        uploadId: upload._id,
        objectKey: upload.objectKey,
        status: "UPLOAD_REQUIRED",
        uploadUrl,
        expiresAt: new Date(validUntil).toISOString(),
        headers: { "content-type": upload.mimeType },
      };
    },

    async complete(storeId, uploadId, input) {
      const db = await database.getDb();
      const upload = await db
        .collection<UploadRecord>("sourceUploads")
        .findOne({ _id: uploadId, storeId });
      if (!upload) {
        throw new AuthError(
          404,
          "SOURCE_UPLOAD_NOT_FOUND",
          "Cet envoi de fichier est introuvable.",
        );
      }
      if (
        upload.checksum !== input.checksum ||
        upload.sizeBytes !== input.sizeBytes
      ) {
        throw new AuthError(
          409,
          "SOURCE_UPLOAD_METADATA_MISMATCH",
          "Le fichier envoyé ne correspond pas au document local.",
        );
      }
      if (upload.status === "CONFIRMED") {
        const draft = await processReceiptIfNeeded(
          receiptImages,
          receiptVision,
          receiptArithmetic,
          receiptProductMatching,
          receiptDrafts,
          upload,
        );
        return confirmed(upload, draft);
      }

      const blob = await storage.head(upload.objectKey);
      if (!blob) {
        throw new AuthError(
          409,
          "SOURCE_UPLOAD_INCOMPLETE",
          "Le fichier n’est pas encore disponible dans le stockage.",
          true,
        );
      }
      if (
        blob.size !== upload.sizeBytes ||
        blob.contentType !== upload.mimeType
      ) {
        const timestamp = now();
        await Promise.all([
          db
            .collection<UploadRecord>("sourceUploads")
            .updateOne(
              { _id: upload._id, storeId },
              { $set: { status: "INVALID", updatedAt: timestamp } },
            ),
          db
            .collection<RemoteSourceDocumentRecord>("sourceDocuments")
            .updateOne(
              { _id: upload.sourceDocumentId, storeId },
              { $set: { remoteUploadStatus: "INVALID", updatedAt: timestamp } },
            ),
        ]);
        return {
          sourceDocumentId: upload.sourceDocumentId,
          remoteUploadStatus: "INVALID",
          jobId: null,
        };
      }

      await confirmUpload(database, upload, blob, now());
      const draft = await processReceiptIfNeeded(
        receiptImages,
        receiptVision,
        receiptArithmetic,
        receiptProductMatching,
        receiptDrafts,
        upload,
      );
      return confirmed(upload, draft);
    },
  };
}

async function processReceiptIfNeeded(
  receiptImages: WasteReceiptImageNormalizationService,
  receiptVision: WasteReceiptVisionExtractionService | undefined,
  receiptArithmetic: WasteReceiptArithmeticValidationService | undefined,
  receiptProductMatching: WasteReceiptProductMatchingService | undefined,
  receiptDrafts: WasteReceiptDraftReader | undefined,
  upload: UploadRecord,
) {
  if (upload.sourceType !== "WASTE_RECEIPT") return;
  await receiptImages.normalize({
    storeId: upload.storeId,
    sourceDocumentId: upload.sourceDocumentId,
    sourceObjectKey: upload.objectKey,
  });
  await receiptVision?.extract({
    storeId: upload.storeId,
    sourceDocumentId: upload.sourceDocumentId,
  });
  await receiptArithmetic?.validate({
    storeId: upload.storeId,
    sourceDocumentId: upload.sourceDocumentId,
  });
  await receiptProductMatching?.match({
    storeId: upload.storeId,
    sourceDocumentId: upload.sourceDocumentId,
  });
  return receiptDrafts?.read({
    storeId: upload.storeId,
    sourceDocumentId: upload.sourceDocumentId,
  });
}

function assertSameUpload(
  upload: UploadRecord,
  input: InitSourceUploadRequest,
) {
  if (
    upload.sourceType !== input.sourceType ||
    upload.filename !== input.filename ||
    upload.mimeType !== input.mimeType ||
    upload.sizeBytes !== input.sizeBytes ||
    upload.checksum !== input.checksum
  ) {
    throw new AuthError(
      409,
      "SOURCE_DOCUMENT_ALREADY_REGISTERED",
      "Ce document source est déjà enregistré avec un autre fichier.",
    );
  }
}

function assertBlobMatches(upload: UploadRecord, blob: SourceBlobMetadata) {
  if (
    blob.pathname !== upload.objectKey ||
    blob.size !== upload.sizeBytes ||
    blob.contentType !== upload.mimeType
  ) {
    throw new AuthError(
      409,
      "SOURCE_UPLOAD_METADATA_MISMATCH",
      "Le fichier stocké ne correspond pas au document local.",
    );
  }
}

async function confirmUpload(
  database: DatabaseService,
  upload: UploadRecord,
  blob: SourceBlobMetadata,
  timestamp: Date,
) {
  const db = await database.getDb();
  await Promise.all([
    db.collection<UploadRecord>("sourceUploads").updateOne(
      { _id: upload._id, storeId: upload.storeId },
      {
        $set: {
          status: "CONFIRMED",
          blob,
          confirmedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    ),
    db.collection<RemoteSourceDocumentRecord>("sourceDocuments").updateOne(
      { _id: upload.sourceDocumentId, storeId: upload.storeId },
      {
        $set: {
          remoteUploadStatus: "CONFIRMED",
          blobUrl: blob.url,
          blobEtag: blob.etag,
          updatedAt: timestamp,
        },
      },
    ),
  ]);
}

function sourceObjectKey(storeId: string, input: InitSourceUploadRequest) {
  const safeFilename =
    input.filename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-120) || "source";
  const digest = input.checksum.slice("sha256:".length);
  return `sources/${storeId}/${input.sourceDocumentId}/${digest}-${safeFilename}`;
}

function alreadyUploaded(upload: UploadRecord): InitSourceUploadResponse {
  return {
    uploadId: upload._id,
    objectKey: upload.objectKey,
    status: "ALREADY_UPLOADED",
    uploadUrl: null,
    expiresAt: null,
    headers: {},
  };
}

function confirmed(
  upload: UploadRecord,
  wasteReceiptDraft?: WasteReceiptDraft,
): CompleteSourceUploadResponse {
  return {
    sourceDocumentId: upload.sourceDocumentId,
    remoteUploadStatus: "CONFIRMED",
    jobId: null,
    wasteReceiptDraft,
  };
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
