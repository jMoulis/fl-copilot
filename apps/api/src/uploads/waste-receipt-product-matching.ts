import { createHash, randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import {
  defaultProductMatcherConfig,
  matchProduct,
  type Product,
  type ProductMatchCandidate,
  type ProductMatchCatalog,
  type ProductMatchResult,
} from "@fl-copilot/domain";
import type { DatabaseService } from "../database/types.js";
import {
  serializeProductAliasDocument,
  serializeProductDocument,
  serializeProductIdentifierDocument,
  type ProductAliasDocument,
  type ProductDocument,
  type ProductIdentifierDocument,
} from "../products/product-master.js";

export interface WasteReceiptProductMatchingService {
  match(input: { storeId: string; sourceDocumentId: string }): Promise<void>;
}

export interface ProductCatalogLoader {
  load(storeId: string): Promise<ProductMatchCatalog>;
}

type RemoteSourceDocumentRecord = {
  _id: string;
  storeId: string;
  sourceType: string;
  extractionStatus?: string;
  extractionId?: string;
  arithmeticValidationStatus?: string;
};

type WasteReceiptExtractionRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  output: {
    lines: Array<{ sourceLineIndex: number; rawLabel: string }>;
  };
};

type CandidateProductSnapshot = {
  productId: string;
  label: string;
  nature: Product["nature"];
  salesUnit: Product["salesUnit"];
  score: number;
  method: ProductMatchCandidate["method"];
  reasons: string[];
};

type WasteReceiptProductMatchLine = {
  sourceLineIndex: number;
  rawLabel: string;
  matchResult: ProductMatchResult;
  matchedProduct: {
    productId: string;
    label: string;
    nature: Product["nature"];
    salesUnit: Product["salesUnit"];
  } | null;
  candidates: CandidateProductSnapshot[];
};

type WasteReceiptProductMatchingRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  extractionId: string;
  engineVersion: string;
  catalogFingerprint: string;
  lines: WasteReceiptProductMatchLine[];
  summary: {
    matchedLineCount: number;
    reviewLineCount: number;
    ambiguousLineCount: number;
    unmatchedLineCount: number;
    bulkMatchedLineCount: number;
    packagedMatchedLineCount: number;
    unknownNatureMatchedLineCount: number;
  };
  matchedAt: Date;
};

export function createMongoProductCatalogLoader(
  database: DatabaseService,
): ProductCatalogLoader {
  return {
    async load(storeId) {
      const db = await database.getDb();
      const [products, identifiers, aliases] = await Promise.all([
        db
          .collection<ProductDocument>("products")
          .find({ storeId, deletedAt: null })
          .sort({ _id: 1 })
          .toArray(),
        db
          .collection<ProductIdentifierDocument>("productIdentifiers")
          .find({ storeId, deletedAt: null })
          .sort({ _id: 1 })
          .toArray(),
        db
          .collection<ProductAliasDocument>("productAliases")
          .find({ storeId, deletedAt: null })
          .sort({ _id: 1 })
          .toArray(),
      ]);
      return {
        products: products.map(serializeProductDocument),
        identifiers: identifiers.map(serializeProductIdentifierDocument),
        aliases: aliases.map(serializeProductAliasDocument),
      };
    },
  };
}

export function createMongoWasteReceiptProductMatchingService(
  database: DatabaseService,
  catalogLoader: ProductCatalogLoader = createMongoProductCatalogLoader(
    database,
  ),
  now: () => Date = () => new Date(),
): WasteReceiptProductMatchingService {
  return {
    async match(input) {
      const db = await database.getDb();
      const documents =
        db.collection<RemoteSourceDocumentRecord>("sourceDocuments");
      const extractions = db.collection<WasteReceiptExtractionRecord>(
        "wasteReceiptExtractions",
      );
      const matches = db.collection<WasteReceiptProductMatchingRecord>(
        "wasteReceiptProductMatches",
      );
      const document = await documents.findOne({
        _id: input.sourceDocumentId,
        storeId: input.storeId,
      });
      if (
        !document ||
        document.sourceType !== "WASTE_RECEIPT" ||
        document.extractionStatus !== "READY" ||
        document.arithmeticValidationStatus !== "READY" ||
        !document.extractionId
      ) {
        throw new Error("WASTE_RECEIPT_ARITHMETIC_VALIDATION_NOT_READY");
      }

      try {
        const extraction = await extractions.findOne({
          _id: document.extractionId,
          storeId: input.storeId,
          sourceDocumentId: input.sourceDocumentId,
        });
        if (!extraction) {
          throw new Error("WASTE_RECEIPT_EXTRACTION_NOT_FOUND");
        }
        const catalog = await catalogLoader.load(input.storeId);
        const catalogFingerprint = fingerprintCatalog(catalog);
        const identity = {
          storeId: input.storeId,
          sourceDocumentId: input.sourceDocumentId,
          extractionId: extraction._id,
          engineVersion: defaultProductMatcherConfig.version,
          catalogFingerprint,
        };
        const existing = await matches.findOne(identity);
        if (existing) {
          await markMatchingReady(documents, existing, now());
          return;
        }

        const productsById = new Map(
          catalog.products.map((product) => [product.id, product]),
        );
        const lines = extraction.output.lines.map((line) =>
          matchLine(input.storeId, line, catalog, productsById),
        );
        const record: WasteReceiptProductMatchingRecord = {
          _id: randomUUID(),
          ...identity,
          lines,
          summary: summarize(lines),
          matchedAt: now(),
        };
        try {
          await matches.insertOne(record);
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          const concurrent = await matches.findOne(identity);
          if (!concurrent) throw error;
          await markMatchingReady(documents, concurrent, now());
          return;
        }
        await markMatchingReady(documents, record, now());
      } catch (error) {
        await markMatchingFailed(documents, input, error, now());
        throw error;
      }
    },
  };
}

function matchLine(
  storeId: string,
  line: { sourceLineIndex: number; rawLabel: string },
  catalog: ProductMatchCatalog,
  productsById: ReadonlyMap<string, Product>,
): WasteReceiptProductMatchLine {
  const matchResult = matchProduct(
    { storeId, identifiers: [], label: line.rawLabel },
    catalog,
  );
  const matched = matchResult.matchedProductId
    ? productsById.get(matchResult.matchedProductId)
    : undefined;
  return {
    sourceLineIndex: line.sourceLineIndex,
    rawLabel: line.rawLabel,
    matchResult,
    matchedProduct: matched
      ? {
          productId: matched.id,
          label: matched.label,
          nature: matched.nature,
          salesUnit: matched.salesUnit,
        }
      : null,
    candidates: matchResult.candidates.flatMap((candidate) => {
      const product = productsById.get(candidate.productId);
      return product
        ? [
            {
              productId: product.id,
              label: product.label,
              nature: product.nature,
              salesUnit: product.salesUnit,
              score: candidate.score,
              method: candidate.method,
              reasons: candidate.reasons,
            },
          ]
        : [];
    }),
  };
}

function summarize(lines: readonly WasteReceiptProductMatchLine[]) {
  const matched = lines.filter(
    (line) => line.matchResult.state === "AUTO_MATCH",
  );
  return {
    matchedLineCount: matched.length,
    reviewLineCount: lines.filter((line) => line.matchResult.state === "REVIEW")
      .length,
    ambiguousLineCount: lines.filter(
      (line) => line.matchResult.state === "AMBIGUOUS",
    ).length,
    unmatchedLineCount: lines.filter(
      (line) => line.matchResult.state === "NO_MATCH",
    ).length,
    bulkMatchedLineCount: matched.filter(
      (line) => line.matchedProduct?.nature === "BULK",
    ).length,
    packagedMatchedLineCount: matched.filter(
      (line) => line.matchedProduct?.nature === "PACKAGED",
    ).length,
    unknownNatureMatchedLineCount: matched.filter(
      (line) => line.matchedProduct?.nature === "UNKNOWN",
    ).length,
  };
}

function fingerprintCatalog(catalog: ProductMatchCatalog) {
  const snapshot = {
    products: [...catalog.products]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, version, status, label, nature, salesUnit, deletedAt }) => ({
        id,
        version,
        status,
        label,
        nature,
        salesUnit,
        deletedAt: deletedAt ?? null,
      })),
    identifiers: [...catalog.identifiers]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, version, status, productId, type, value, deletedAt }) => ({
        id,
        version,
        status,
        productId,
        type,
        value,
        deletedAt: deletedAt ?? null,
      })),
    aliases: [...catalog.aliases]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(
        ({ id, version, status, productId, normalizedAlias, deletedAt }) => ({
          id,
          version,
          status,
          productId,
          normalizedAlias,
          deletedAt: deletedAt ?? null,
        }),
      ),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function markMatchingReady(
  documents: Collection<RemoteSourceDocumentRecord>,
  matching: WasteReceiptProductMatchingRecord,
  timestamp: Date,
) {
  await documents.updateOne(
    { _id: matching.sourceDocumentId, storeId: matching.storeId },
    {
      $set: {
        productMatchingStatus: "READY",
        productMatchingId: matching._id,
        productMatcherVersion: matching.engineVersion,
        productCatalogFingerprint: matching.catalogFingerprint,
        productMatchedLineCount: matching.summary.matchedLineCount,
        productReviewLineCount:
          matching.summary.reviewLineCount +
          matching.summary.ambiguousLineCount,
        productUnmatchedLineCount: matching.summary.unmatchedLineCount,
        productMatchingFailureCode: null,
        remoteProcessingStatus: "TO_VALIDATE",
        updatedAt: timestamp,
      },
    },
  );
}

async function markMatchingFailed(
  documents: Collection<RemoteSourceDocumentRecord>,
  input: { storeId: string; sourceDocumentId: string },
  error: unknown,
  timestamp: Date,
) {
  const failureCode =
    error instanceof Error
      ? error.message.slice(0, 120)
      : "WASTE_RECEIPT_PRODUCT_MATCHING_FAILED";
  await documents.updateOne(
    { _id: input.sourceDocumentId, storeId: input.storeId },
    {
      $set: {
        productMatchingStatus: "FAILED",
        productMatchingFailureCode: failureCode,
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
