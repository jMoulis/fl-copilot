import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import {
  fingerprintMercalysRecords,
  parseMercalysSales,
  parseMercalysWaste,
  SheetJsSpreadsheetParser,
} from "@fl-copilot/import-core";
import type {
  ImportVerificationResult,
  VerifyImportRequest,
} from "@fl-copilot/sync-contracts";
import { AuthError } from "../auth/service.js";
import type { DatabaseService } from "../database/types.js";

export interface PrivateSourceReader {
  read(pathname: string): Promise<Uint8Array | null>;
}

export interface ImportVerificationService {
  verify(
    storeId: string,
    sourceDocumentId: string,
    input: VerifyImportRequest,
  ): Promise<ImportVerificationResult>;
}

export interface RemoteMercalysParser {
  parse(
    bytes: Uint8Array,
    sourceType: VerifyImportRequest["sourceType"],
  ): {
    parserVersion: string;
    businessPeriodStart: string;
    businessPeriodEnd: string;
    records: Parameters<typeof fingerprintMercalysRecords>[0];
  };
}

type RemoteSourceDocumentRecord = {
  _id: string;
  storeId: string;
  sourceType: string;
  checksum: string;
  remoteUploadStatus: string;
  objectKey: string;
};

export function createVercelPrivateSourceReader(): PrivateSourceReader {
  return {
    async read(pathname) {
      const result = await get(pathname, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
  };
}

export function createMongoImportVerificationService(
  database: DatabaseService,
  reader: PrivateSourceReader = createVercelPrivateSourceReader(),
  now: () => Date = () => new Date(),
  parser: RemoteMercalysParser = defaultRemoteMercalysParser,
): ImportVerificationService {
  return {
    async verify(storeId, sourceDocumentId, input) {
      const db = await database.getDb();
      const documents =
        db.collection<RemoteSourceDocumentRecord>("sourceDocuments");
      const document = await documents.findOne({
        _id: sourceDocumentId,
        storeId,
      });
      if (!document) {
        throw new AuthError(
          404,
          "SOURCE_DOCUMENT_NOT_FOUND",
          "Ce document source est introuvable.",
        );
      }
      if (document.remoteUploadStatus !== "CONFIRMED") {
        throw new AuthError(
          409,
          "SOURCE_UPLOAD_INCOMPLETE",
          "Le fichier doit être envoyé avant sa vérification.",
          true,
        );
      }
      if (
        document.sourceType !== input.sourceType ||
        document.checksum !== input.checksum
      ) {
        throw new AuthError(
          409,
          "IMPORT_VERIFICATION_METADATA_MISMATCH",
          "Les informations de vérification ne correspondent pas au document.",
        );
      }

      let result: ImportVerificationResult;
      let parserVersion: string | null = null;
      let remoteRecordCount: number | null = null;
      let failureCode: string | null = null;
      // Transport/storage failures remain HTTP failures so the durable mobile queue retries.
      const bytes = await reader.read(document.objectKey);
      try {
        if (!bytes) throw new Error("SOURCE_BLOB_NOT_FOUND");
        const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        if (checksum !== input.checksum) {
          throw new Error("SOURCE_CHECKSUM_MISMATCH");
        }
        const parsed = parser.parse(bytes, input.sourceType);
        parserVersion = parsed.parserVersion;
        remoteRecordCount = parsed.records.length;
        const remoteFingerprint = fingerprintMercalysRecords(parsed.records);
        const matches =
          remoteFingerprint === input.localNormalizedFingerprint &&
          parsed.records.length === input.localRecordCount &&
          parsed.businessPeriodStart === input.businessPeriodStart &&
          parsed.businessPeriodEnd === input.businessPeriodEnd;
        result = {
          sourceDocumentId,
          status: matches ? "MATCH" : "DIFFERENCE",
          localFingerprint: input.localNormalizedFingerprint,
          remoteFingerprint,
        };
      } catch (error) {
        failureCode =
          error instanceof Error
            ? error.message.slice(0, 120)
            : "REMOTE_IMPORT_VERIFICATION_FAILED";
        result = {
          sourceDocumentId,
          status: "FAILED",
          localFingerprint: input.localNormalizedFingerprint,
          remoteFingerprint: null,
        };
      }

      const timestamp = now();
      await documents.updateOne(
        { _id: sourceDocumentId, storeId },
        {
          $set: {
            verificationStatus: result.status,
            localNormalizedFingerprint: input.localNormalizedFingerprint,
            remoteNormalizedFingerprint: result.remoteFingerprint ?? null,
            localRecordCount: input.localRecordCount,
            remoteRecordCount,
            localBusinessPeriodStart: input.businessPeriodStart,
            localBusinessPeriodEnd: input.businessPeriodEnd,
            remoteParserVersion: parserVersion,
            remoteProcessingStatus:
              result.status === "MATCH"
                ? "PUBLISHED"
                : result.status === "DIFFERENCE"
                  ? "RECONCILING"
                  : "FAILED",
            verificationFailureCode: failureCode,
            verifiedAt: timestamp,
            updatedAt: timestamp,
          },
        },
      );
      return result;
    },
  };
}

const defaultRemoteMercalysParser: RemoteMercalysParser = {
  parse(bytes, sourceType) {
    const workbook = new SheetJsSpreadsheetParser().parse(bytes);
    return sourceType === "MERCALYS_SALES"
      ? parseMercalysSales(workbook)
      : parseMercalysWaste(workbook);
  },
};
