import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import {
  BusinessDecimal,
  validateWasteReceiptArithmetic,
  WASTE_RECEIPT_ARITHMETIC_VALIDATOR_VERSION,
  type WasteReceiptArithmeticValidationResult,
} from "@fl-copilot/analytics-core";
import type { DatabaseService } from "../database/types.js";

export interface WasteReceiptArithmeticValidationService {
  validate(input: { storeId: string; sourceDocumentId: string }): Promise<void>;
}

type RemoteSourceDocumentRecord = {
  _id: string;
  storeId: string;
  sourceType: string;
  extractionStatus?: string;
  extractionId?: string;
};

type ExtractionLine = {
  sourceLineIndex: number;
  weight: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
};

type WasteReceiptExtractionRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  output: { lines: ExtractionLine[] };
};

type WasteReceiptArithmeticValidationRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  extractionId: string;
  validatorVersion: string;
  tolerance: string;
  result: WasteReceiptArithmeticValidationResult;
  validatedAt: Date;
};

export function createMongoWasteReceiptArithmeticValidationService(
  database: DatabaseService,
  tolerance: string,
  now: () => Date = () => new Date(),
): WasteReceiptArithmeticValidationService {
  return {
    async validate(input) {
      const db = await database.getDb();
      const documents =
        db.collection<RemoteSourceDocumentRecord>("sourceDocuments");
      const extractions = db.collection<WasteReceiptExtractionRecord>(
        "wasteReceiptExtractions",
      );
      const validations = db.collection<WasteReceiptArithmeticValidationRecord>(
        "wasteReceiptArithmeticValidations",
      );
      const document = await documents.findOne({
        _id: input.sourceDocumentId,
        storeId: input.storeId,
      });
      if (
        !document ||
        document.sourceType !== "WASTE_RECEIPT" ||
        document.extractionStatus !== "READY" ||
        !document.extractionId
      ) {
        throw new Error("WASTE_RECEIPT_EXTRACTION_NOT_READY");
      }
      const extraction = await extractions.findOne({
        _id: document.extractionId,
        storeId: input.storeId,
        sourceDocumentId: input.sourceDocumentId,
      });
      if (!extraction) {
        throw new Error("WASTE_RECEIPT_EXTRACTION_NOT_FOUND");
      }

      const result = validateWasteReceiptArithmetic(
        extraction.output.lines.map((line) => ({
          sourceLineIndex: line.sourceLineIndex,
          weight: decimalString(line.weight),
          unitPrice: decimalString(line.unitPrice),
          totalPrice: decimalString(line.totalPrice),
        })),
        tolerance,
      );
      const identity = {
        storeId: input.storeId,
        sourceDocumentId: input.sourceDocumentId,
        extractionId: extraction._id,
        validatorVersion: WASTE_RECEIPT_ARITHMETIC_VALIDATOR_VERSION,
        tolerance: result.tolerance,
      };
      const existing = await validations.findOne(identity);
      if (existing) {
        await markValidationReady(documents, existing, now());
        return;
      }

      const validation: WasteReceiptArithmeticValidationRecord = {
        _id: randomUUID(),
        ...identity,
        result,
        validatedAt: now(),
      };
      try {
        await validations.insertOne(validation);
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          await markValidationFailed(documents, input, error, now());
          throw error;
        }
        const concurrent = await validations.findOne(identity);
        if (!concurrent) {
          await markValidationFailed(documents, input, error, now());
          throw error;
        }
        await markValidationReady(documents, concurrent, now());
        return;
      }
      await markValidationReady(documents, validation, now());
    },
  };
}

function decimalString(value: number | null) {
  return value === null ? null : new BusinessDecimal(value).toFixed();
}

async function markValidationReady(
  documents: Collection<RemoteSourceDocumentRecord>,
  validation: WasteReceiptArithmeticValidationRecord,
  timestamp: Date,
) {
  await documents.updateOne(
    { _id: validation.sourceDocumentId, storeId: validation.storeId },
    {
      $set: {
        arithmeticValidationStatus: "READY",
        arithmeticValidationId: validation._id,
        arithmeticValidatorVersion: validation.validatorVersion,
        arithmeticWarningCount: validation.result.mismatchLineCount,
        arithmeticUncheckedLineCount: validation.result.uncheckedLineCount,
        arithmeticValidationFailureCode: null,
        remoteProcessingStatus: "TO_VALIDATE",
        updatedAt: timestamp,
      },
    },
  );
}

async function markValidationFailed(
  documents: Collection<RemoteSourceDocumentRecord>,
  input: { storeId: string; sourceDocumentId: string },
  error: unknown,
  timestamp: Date,
) {
  const failureCode =
    error instanceof Error
      ? error.message.slice(0, 120)
      : "WASTE_RECEIPT_ARITHMETIC_VALIDATION_FAILED";
  await documents.updateOne(
    { _id: input.sourceDocumentId, storeId: input.storeId },
    {
      $set: {
        arithmeticValidationStatus: "FAILED",
        arithmeticValidationFailureCode: failureCode,
        remoteProcessingStatus: "FAILED",
        updatedAt: timestamp,
      },
    },
  );
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
