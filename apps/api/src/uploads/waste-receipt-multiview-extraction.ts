import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { RECEIPT_PHOTO_BUNDLE_MIME } from "@fl-copilot/domain";
import { AuthError } from "../auth/service.js";
import type { ReceiptImageStorage } from "./waste-receipt-image-normalization.js";
import type { ReceiptVisionProvider } from "./waste-receipt-vision-extraction.js";
import {
  normalizedReceiptViewsSchema,
  receiptBytesChecksum,
  receiptViewDerivativeObjectKey,
} from "./receipt-photo-bundle.js";
import {
  wasteReceiptMultiViewVisionOutputSchema,
  type WasteReceiptMultiViewVisionOutput,
} from "./waste-receipt-vision-output.js";

export const WASTE_RECEIPT_MULTIVIEW_SCHEMA_VERSION =
  "waste-receipt.vision.multiview.v1";
export const MAX_RECEIPT_MULTIVIEW_ATTEMPTS = 4;
const LEASE_MS = 180_000;
type SourceRecord = {
  _id: string;
  storeId: string;
  checksum?: string;
  createdAt?: Date;
  normalizedGroupChecksum?: string;
  normalizedViews?: unknown;
  groupVisionReviewRequired?: boolean;
  groupVisionProvider?: string | null;
  groupVisionModel?: string | null;
  groupVisionAttemptCount?: number;
  groupVisionLeaseToken?: string | null;
  groupVisionLeaseUntil?: Date | null;
};
type ExtractionRecord = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  sourceChecksum: string;
  provider: string;
  model: string;
  resolvedModel: string;
  responseId: string;
  schemaVersion: string;
  extractedAt: Date;
  reusedFromExtractionId?: string;
  output: Omit<WasteReceiptMultiViewVisionOutput, "lines"> & {
    lines: Array<
      Omit<
        WasteReceiptMultiViewVisionOutput["lines"][number],
        "sourceRegion"
      > & {
        sourceRegion: {
          imageIndexes: number[];
          region: WasteReceiptMultiViewVisionOutput["lines"][number]["sourceRegion"];
        };
      }
    >;
  };
};

function reviewRequired() {
  return new AuthError(
    422,
    "WASTE_RECEIPT_MULTIVIEW_REVIEW_REQUIRED",
    "Ces vues ne permettent pas de compter les lignes avec certitude. Vérifiez qu’elles montrent un seul ticket, dans l’ordre et avec un léger recouvrement, puis importez les photos corrigées. Les originaux sont conservés.",
  );
}
function processingPending() {
  return new AuthError(
    409,
    "WASTE_RECEIPT_MULTIVIEW_PROCESSING",
    "L’analyse de ce ticket est déjà en cours. Réessayez la synchronisation dans quelques instants.",
    true,
  );
}

/** Group-only adapter; the historical single-photo schema and budgets remain unchanged. */
export async function extractReceiptViews(
  db: Db,
  input: { storeId: string; sourceDocumentId: string },
  provider: ReceiptVisionProvider,
  storage: Pick<ReceiptImageStorage, "read">,
  now: () => Date,
) {
  const documents = db.collection<SourceRecord>("sourceDocuments");
  const scope = {
    _id: input.sourceDocumentId,
    storeId: input.storeId,
    sourceType: "WASTE_RECEIPT",
    mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
    remoteUploadStatus: "CONFIRMED",
    normalizationStatus: "READY",
  };
  const document = await documents.findOne(scope);
  if (
    !document ||
    !document.checksum ||
    document.normalizedGroupChecksum !== document.checksum
  )
    throw new AuthError(
      422,
      "WASTE_RECEIPT_MULTIVIEW_SOURCE_INVALID",
      "Les vues de ce ticket ne sont pas prêtes pour l’analyse.",
    );
  const identity = {
    storeId: input.storeId,
    sourceDocumentId: input.sourceDocumentId,
    provider: provider.provider,
    model: provider.model,
    schemaVersion: WASTE_RECEIPT_MULTIVIEW_SCHEMA_VERSION,
  };
  const extractions = db.collection<ExtractionRecord>(
    "wasteReceiptExtractions",
  );
  async function markReady(extraction: ExtractionRecord, leaseToken?: string) {
    const updated = await documents.updateOne(
      {
        ...scope,
        checksum: extraction.sourceChecksum,
        ...(leaseToken
          ? {
              groupVisionLeaseToken: leaseToken,
              groupVisionLeaseUntil: { $gt: now() },
            }
          : {}),
      },
      {
        $set: {
          extractionStatus: "READY",
          extractionId: extraction._id,
          extractionProvider: extraction.provider,
          extractionModelVersion: extraction.resolvedModel,
          extractionSchemaVersion: extraction.schemaVersion,
          extractionFailureCode: null,
          extractedAt: extraction.extractedAt,
          remoteProcessingStatus: "TO_VALIDATE",
          groupVisionLeaseToken: null,
          groupVisionLeaseUntil: null,
          groupVisionProvider: extraction.provider,
          groupVisionModel: extraction.model,
          updatedAt: now(),
        },
      },
    );
    if (updated.matchedCount !== 1) throw processingPending();
  }
  // Completed evidence wins after a lost acknowledgement, without another provider call.
  const existing = await extractions.findOne({
    storeId: input.storeId,
    sourceDocumentId: input.sourceDocumentId,
    schemaVersion: WASTE_RECEIPT_MULTIVIEW_SCHEMA_VERSION,
    sourceChecksum: document.checksum,
  });
  if (existing) {
    await markReady(existing);
    return;
  }
  if (document.groupVisionReviewRequired) throw reviewRequired();
  // An identical immutable group can reuse the earlier source's validated extraction.
  // Keep separate per-source IDs/drafts so an explicit KEEP_BOTH duplicate decision still works.
  if (!(document.createdAt instanceof Date))
    throw new AuthError(
      422,
      "WASTE_RECEIPT_MULTIVIEW_SOURCE_INVALID",
      "L’identité de ce ticket doit être vérifiée avant son analyse.",
    );
  const earlier = await documents.findOne(
    {
      storeId: input.storeId,
      sourceType: "WASTE_RECEIPT",
      mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
      remoteUploadStatus: "CONFIRMED",
      checksum: document.checksum,
      $or: [
        { createdAt: { $lt: document.createdAt } },
        { createdAt: document.createdAt, _id: { $lt: input.sourceDocumentId } },
      ],
    },
    { sort: { createdAt: 1, _id: 1 } },
  );
  if (earlier) {
    const prior = await extractions.findOne({
      storeId: input.storeId,
      sourceDocumentId: earlier._id,
      schemaVersion: WASTE_RECEIPT_MULTIVIEW_SCHEMA_VERSION,
      sourceChecksum: document.checksum,
    });
    if (!prior) {
      if (earlier.groupVisionReviewRequired) throw reviewRequired();
      if (
        (earlier.groupVisionAttemptCount ?? 0) >=
          MAX_RECEIPT_MULTIVIEW_ATTEMPTS &&
        (!earlier.groupVisionLeaseUntil ||
          earlier.groupVisionLeaseUntil <= now())
      )
        throw new AuthError(
          422,
          "WASTE_RECEIPT_MULTIVIEW_ATTEMPTS_EXHAUSTED",
          "L’analyse du ticket identique a épuisé ses tentatives. Conservez les photos et contactez le support.",
        );
      throw processingPending();
    }
    const reused: ExtractionRecord = {
      ...prior,
      sourceDocumentId: input.sourceDocumentId,
      _id: randomUUID(),
      reusedFromExtractionId: prior._id,
    };
    const reusedIdentity = {
      ...identity,
      provider: prior.provider,
      model: prior.model,
    };
    try {
      await extractions.updateOne(
        reusedIdentity,
        { $setOnInsert: reused },
        { upsert: true },
      );
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      ))
        throw error;
    }
    const saved = await extractions.findOne({
      ...reusedIdentity,
      sourceChecksum: document.checksum,
    });
    if (!saved) throw processingPending();
    await markReady(saved);
    return;
  }

  if (
    (document.groupVisionProvider &&
      document.groupVisionProvider !== provider.provider) ||
    (document.groupVisionModel && document.groupVisionModel !== provider.model)
  )
    throw new AuthError(
      422,
      "WASTE_RECEIPT_MULTIVIEW_MODEL_CHANGED",
      "La configuration de cette analyse a changé. Conservez les photos et contactez le support avant de la reprendre.",
    );
  if (!provider.extractViews)
    throw new AuthError(
      503,
      "WASTE_RECEIPT_MULTIVIEW_NOT_CONFIGURED",
      "L’analyse de plusieurs vues n’est pas disponible pour le moment.",
      true,
    );
  const views = normalizedReceiptViewsSchema.safeParse(
    document.normalizedViews,
  );
  if (
    !views.success ||
    views.data.some(
      (view, index) =>
        view.imageIndex !== index ||
        view.objectKey !==
          receiptViewDerivativeObjectKey(
            input.storeId,
            input.sourceDocumentId,
            index,
          ),
    )
  )
    throw new AuthError(
      422,
      "WASTE_RECEIPT_MULTIVIEW_SOURCE_INVALID",
      "Les vues de ce ticket ne sont pas prêtes pour l’analyse.",
    );

  const leaseToken = randomUUID(),
    timestamp = now();
  const claimed = await documents.findOneAndUpdate(
    {
      ...scope,
      checksum: document.checksum,
      normalizedGroupChecksum: document.checksum,
      groupVisionReviewRequired: { $ne: true },
      groupVisionProvider: { $in: [null, provider.provider] },
      groupVisionModel: { $in: [null, provider.model] },
      extractionStatus: { $ne: "READY" },
      $and: [
        {
          $or: [
            { groupVisionAttemptCount: { $exists: false } },
            {
              groupVisionAttemptCount: { $lt: MAX_RECEIPT_MULTIVIEW_ATTEMPTS },
            },
          ],
        },
        {
          $or: [
            { groupVisionLeaseUntil: null },
            { groupVisionLeaseUntil: { $lte: timestamp } },
          ],
        },
      ],
    },
    {
      $set: {
        groupVisionProvider: provider.provider,
        groupVisionModel: provider.model,
        groupVisionLeaseToken: leaseToken,
        groupVisionLeaseUntil: new Date(timestamp.getTime() + LEASE_MS),
        extractionStatus: "EXTRACTING",
        extractionFailureCode: null,
        remoteProcessingStatus: "EXTRACTING",
        updatedAt: timestamp,
      },
      $inc: { groupVisionAttemptCount: 1 },
    },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const current = await documents.findOne(scope);
    const completed = await extractions.findOne({
      ...identity,
      sourceChecksum: document.checksum,
    });
    if (completed) {
      await markReady(completed);
      return;
    }
    if (current?.groupVisionReviewRequired) throw reviewRequired();
    if (
      (current?.groupVisionAttemptCount ?? 0) >=
        MAX_RECEIPT_MULTIVIEW_ATTEMPTS &&
      (!current?.groupVisionLeaseUntil ||
        current.groupVisionLeaseUntil <= now())
    )
      throw new AuthError(
        422,
        "WASTE_RECEIPT_MULTIVIEW_ATTEMPTS_EXHAUSTED",
        "Les tentatives d’analyse de ce ticket sont épuisées. Conservez ses photos et contactez le support avant de relancer une analyse.",
      );
    throw processingPending();
  }
  const leaseScope = {
    ...scope,
    checksum: document.checksum,
    groupVisionLeaseToken: leaseToken,
    groupVisionLeaseUntil: { $gt: now() },
  };
  try {
    const images: Uint8Array[] = [];
    for (const view of views.data) {
      const image = await storage.read(view.objectKey);
      if (
        !image ||
        image.byteLength !== view.sizeBytes ||
        receiptBytesChecksum(image) !== view.checksum
      )
        throw new AuthError(
          422,
          "WASTE_RECEIPT_MULTIVIEW_DERIVATIVE_INVALID",
          "Une vue du ticket est indisponible ou a changé. Les photos originales sont conservées.",
        );
      images.push(image);
    }
    const result = await provider.extractViews(images);
    const parsed = wasteReceiptMultiViewVisionOutputSchema.safeParse(
      result.output,
    );
    if (!parsed.success || !isCoherentReceipt(parsed.data, views.data.length))
      throw reviewRequired();
    if (
      !(await documents.findOne({
        ...leaseScope,
        groupVisionLeaseUntil: { $gt: now() },
      }))
    )
      throw processingPending();
    const extraction: ExtractionRecord = {
      _id: randomUUID(),
      ...identity,
      sourceChecksum: document.checksum,
      resolvedModel: result.model,
      responseId: result.responseId,
      extractedAt: now(),
      output: {
        ...parsed.data,
        lines: parsed.data.lines.map((line) => ({
          ...line,
          sourceRegion: {
            imageIndexes: line.sourceImageIndexes,
            region: line.sourceRegion,
          },
        })),
      },
    };
    // Existing unique extraction identity makes crash/retry insertion idempotent.
    await extractions.updateOne(
      identity,
      { $setOnInsert: extraction },
      { upsert: true },
    );
    const saved = await extractions.findOne({
      ...identity,
      sourceChecksum: document.checksum,
    });
    if (!saved) throw processingPending();
    await markReady(saved, leaseToken);
  } catch (error) {
    const code =
      error instanceof AuthError
        ? error.publicCode
        : "WASTE_RECEIPT_MULTIVIEW_FAILED";
    await documents.updateOne(
      { ...leaseScope, groupVisionLeaseUntil: { $gt: now() } },
      {
        $set: {
          extractionStatus: "FAILED",
          extractionFailureCode: code,
          remoteProcessingStatus: "FAILED",
          groupVisionReviewRequired:
            code === "WASTE_RECEIPT_MULTIVIEW_REVIEW_REQUIRED",
          groupVisionLeaseToken: null,
          groupVisionLeaseUntil: null,
          updatedAt: now(),
        },
      },
    );
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      503,
      code,
      "L’analyse des photos est momentanément indisponible. Vos originaux restent conservés.",
      true,
    );
  }
}

function isCoherentReceipt(
  output: WasteReceiptMultiViewVisionOutput,
  viewCount: number,
) {
  if (!output.singleReceipt || !output.overlapResolved) return false;
  if (
    output.cashierImageIndex !== null &&
    output.cashierImageIndex >= viewCount
  )
    return false;
  if (output.cashierNumber !== null && output.cashierImageIndex === null)
    return false;
  return output.lines.every(
    (line, index) =>
      line.sourceLineIndex === index &&
      new Set(line.sourceImageIndexes).size ===
        line.sourceImageIndexes.length &&
      line.sourceImageIndexes.every(
        (imageIndex, i, list) =>
          imageIndex < viewCount && (i === 0 || imageIndex > list[i - 1]!),
      ),
  );
}
