import { createHash } from "node:crypto";
import { BusinessDecimal } from "@fl-copilot/analytics-core";
import {
  wasteReceiptDraftSchema,
  type WasteReceiptDraft,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types.js";

export interface WasteReceiptDraftReader {
  read(input: {
    storeId: string;
    sourceDocumentId: string;
  }): Promise<WasteReceiptDraft>;
}

type SourceDocumentRecord = {
  _id: string;
  storeId: string;
  sourceType: string;
  extractionId?: string;
  arithmeticValidationId?: string;
  productMatchingId?: string;
  extractionModelVersion?: string;
  arithmeticValidatorVersion?: string;
  productMatcherVersion?: string;
};

type ExtractionRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  resolvedModel: string;
  output: {
    detectedReceiptDate: string | null;
    cashierNumber?: string | null;
    lines: Array<{
      sourceLineIndex: number;
      rawLabel: string;
      quantity: number | null;
      weight: number | null;
      quantityUnit: string | null;
      unitPrice: number | null;
      totalPrice: number | null;
      extractionConfidence: unknown;
      sourceRegion: unknown;
    }>;
  };
};

type ArithmeticRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  validatorVersion: string;
  result: {
    lines: Array<{
      sourceLineIndex: number;
      status: "NOT_CHECKED" | "CONSISTENT" | "MISMATCH";
      expectedTotal: string | null;
      absoluteDifference: string | null;
      warningCode: "AMOUNT_TO_REVIEW" | null;
    }>;
  };
};

type MatchingRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  engineVersion: string;
  lines: Array<{
    sourceLineIndex: number;
    matchResult: {
      state: "AUTO_MATCH" | "REVIEW" | "AMBIGUOUS" | "NO_MATCH";
      matchedProductId: string | null;
      candidates: Array<{ score: number }>;
    };
    matchedProduct: {
      productId: string;
      label: string;
      nature: "BULK" | "PACKAGED" | "UNKNOWN";
    } | null;
    candidates: Array<{
      productId: string;
      label: string;
      nature: "BULK" | "PACKAGED" | "UNKNOWN";
      salesUnit: "KG" | "PIECE" | "PACK" | "UNKNOWN";
      score: number;
    }>;
  }>;
};

export function createMongoWasteReceiptDraftReader(
  database: DatabaseService,
): WasteReceiptDraftReader {
  return {
    async read(input) {
      const db = await database.getDb();
      const document = await db
        .collection<SourceDocumentRecord>("sourceDocuments")
        .findOne({ _id: input.sourceDocumentId, storeId: input.storeId });
      if (
        !document ||
        document.sourceType !== "WASTE_RECEIPT" ||
        !document.extractionId ||
        !document.arithmeticValidationId ||
        !document.productMatchingId
      ) {
        throw new Error("WASTE_RECEIPT_DRAFT_NOT_READY");
      }
      const [extraction, arithmetic, matching] = await Promise.all([
        db.collection<ExtractionRecord>("wasteReceiptExtractions").findOne({
          _id: document.extractionId,
          storeId: input.storeId,
          sourceDocumentId: input.sourceDocumentId,
        }),
        db
          .collection<ArithmeticRecord>("wasteReceiptArithmeticValidations")
          .findOne({
            _id: document.arithmeticValidationId,
            storeId: input.storeId,
            sourceDocumentId: input.sourceDocumentId,
          }),
        db.collection<MatchingRecord>("wasteReceiptProductMatches").findOne({
          _id: document.productMatchingId,
          storeId: input.storeId,
          sourceDocumentId: input.sourceDocumentId,
        }),
      ]);
      if (!extraction || !arithmetic || !matching) {
        throw new Error("WASTE_RECEIPT_DRAFT_EVIDENCE_NOT_FOUND");
      }
      const arithmeticByIndex = new Map(
        arithmetic.result.lines.map((line) => [line.sourceLineIndex, line]),
      );
      const matchingByIndex = new Map(
        matching.lines.map((line) => [line.sourceLineIndex, line]),
      );

      return wasteReceiptDraftSchema.parse({
        detectedReceiptDate: extraction.output.detectedReceiptDate,
        detectedCashierNumber: extraction.output.cashierNumber?.trim() || null,
        extractionModelVersion: extraction.resolvedModel,
        arithmeticValidatorVersion: arithmetic.validatorVersion,
        productMatcherVersion: matching.engineVersion,
        lines: extraction.output.lines.map((line) => {
          const arithmeticLine = arithmeticByIndex.get(line.sourceLineIndex);
          const matchingLine = matchingByIndex.get(line.sourceLineIndex);
          if (!arithmeticLine || !matchingLine) {
            throw new Error("WASTE_RECEIPT_DRAFT_LINE_EVIDENCE_INCOMPLETE");
          }
          const needsReview =
            arithmeticLine.status === "MISMATCH" ||
            matchingLine.matchResult.state !== "AUTO_MATCH";
          return {
            lineId: deterministicLineId(
              input.sourceDocumentId,
              line.sourceLineIndex,
            ),
            sourceLineIndex: line.sourceLineIndex,
            rawLabel: line.rawLabel,
            quantity: decimalString(line.quantity),
            weight: decimalString(line.weight),
            quantityUnit: normalizeQuantityUnit(line.quantityUnit),
            unitPrice: decimalString(line.unitPrice),
            totalPrice: decimalString(line.totalPrice),
            extractionConfidence: line.extractionConfidence,
            sourceRegion: line.sourceRegion,
            arithmeticStatus: arithmeticLine.status,
            arithmeticExpectedTotal: arithmeticLine.expectedTotal,
            arithmeticDifference: arithmeticLine.absoluteDifference,
            arithmeticWarningCode: arithmeticLine.warningCode,
            matchState: matchingLine.matchResult.state,
            matchedProductId: matchingLine.matchedProduct?.productId ?? null,
            matchedProductLabel: matchingLine.matchedProduct?.label ?? null,
            matchConfidence:
              matchingLine.matchResult.candidates[0]?.score ?? null,
            productNature: matchingLine.matchedProduct?.nature ?? "UNKNOWN",
            candidates: matchingLine.candidates,
            validationStatus: needsReview ? "TO_REVIEW" : "PENDING",
          };
        }),
      });
    },
  };
}

function decimalString(value: number | null) {
  return value === null ? null : new BusinessDecimal(value).toFixed();
}

function normalizeQuantityUnit(
  value: string | null,
): "KG" | "PIECE" | "PACK" | "UNKNOWN" {
  const normalized = value?.trim().toLocaleUpperCase("fr-FR") ?? "";
  if (["KG", "KILO", "KILOGRAMME", "KILOGRAMMES"].includes(normalized)) {
    return "KG";
  }
  if (["PIECE", "PIÈCE", "U", "UNITE", "UNITÉ"].includes(normalized)) {
    return "PIECE";
  }
  if (["PACK", "BARQUETTE", "LOT", "SACHET", "FILET"].includes(normalized)) {
    return "PACK";
  }
  return "UNKNOWN";
}

function deterministicLineId(
  sourceDocumentId: string,
  sourceLineIndex: number,
) {
  const hash = createHash("sha256")
    .update(`${sourceDocumentId}:${sourceLineIndex}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
