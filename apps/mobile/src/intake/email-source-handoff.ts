import { readNativeEmailProcessingBytes } from "./email-original-files";
import { z } from "zod";
import {
  detectVisualImageMime,
  storePhotoMimeSchema,
  MAX_STORE_PHOTO_PIXELS,
  MAX_STORE_PHOTO_BYTES,
  MAX_RECEIPT_VIEW_BYTES,
  MAX_RECEIPT_ORIGINAL_BYTES,
  MAX_RECEIPT_BUNDLE_BYTES,
  RECEIPT_PHOTO_BUNDLE_VERSION,
  RECEIPT_PHOTO_BUNDLE_MIME,
  serializeReceiptPhotoBundle,
} from "@fl-copilot/domain";
import { emailIntakeOriginalRequestSchema } from "@fl-copilot/sync-contracts";
import {
  assertPdfHeader,
  registerCommercialPdf,
  MAX_COMMERCIAL_PDF_BYTES,
} from "../documents/commercial-pdf-capture";
import { CopilotConversationRepository } from "../copilot/conversation-repository";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import {
  localReceiptPhotoViewsSchema,
  type LocalReceiptPhotoView,
} from "../documents/receipt-photo-views";
import { nativeReceiptViewsIntakeStorage } from "../copilot/receipt-views-intake";
import { sourceOriginalHash } from "../documents/source-original-hash";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import {
  notifyOutboxChanged,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { EmailIntakeCache } from "./email-intake-cache";
import type { EmailOriginalTransfer } from "./email-original-transfer";
import {
  emailProcessingBasis,
  readEmailProcessingAuthority,
  verifiedEmailProcessingOriginal,
  emailSourceFilename,
  type EmailProcessingBasis,
} from "./email-processing-basis";
import { emailProcessingIdentity } from "./email-processing-identity";

const handoffSchema = z.strictObject({
  schemaVersion: z.literal(1),
  receiptId: z.uuid(),
  actionId: z.uuid(),
  processingId: z.uuid(),
  sourceDocumentId: z.uuid(),
  sourceType: z.enum(["WEEKLY_COMMERCIAL_PDF", "WASTE_RECEIPT", "STORE_PHOTO"]),
  sourceChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  wasteReceiptId: z.uuid().nullable(),
  duplicateCandidate: z.boolean(),
  inputs: z
    .array(
      z.strictObject({
        fileId: z.uuid(),
        checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        manifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(5),
});
export type EmailSourceHandoffRecord = z.infer<typeof handoffSchema>;
type Dependencies = {
  read(uri: string, limit: number): Promise<Uint8Array<ArrayBuffer>>;
  imageSize(uri: string): Promise<{ width: number; height: number }>;
  bundle: typeof nativeReceiptViewsIntakeStorage.writeBundle;
};
const nativeDependencies: Dependencies = {
  read: readNativeEmailProcessingBytes,
  async imageSize(uri) {
    const { readNativeImageSize } = await import("../media/image-size");
    return readNativeImageSize(uri);
  },
  bundle: (text, id) => nativeReceiptViewsIntakeStorage.writeBundle(text, id),
};
export type EmailSourceHandoffResult =
  | { status: "CAPTURED"; record: EmailSourceHandoffRecord }
  | { status: "NEEDS_PURPOSE" };
function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  return btoa(chunks.join(""));
}
/** Canonical capture plus a private local pointer, not publication or server completion.
 * The existing upload/analysis jobs own the rest; the chat draft and 10-file composer
 * capacity are unrelated to an admitted email batch. */
export class EmailSourceHandoff {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private cache: EmailIntakeCache,
    private originals: Pick<EmailOriginalTransfer, "local">,
    private deviceId: string,
    private dependencies: Dependencies = nativeDependencies,
  ) {
    z.uuid().parse(deviceId);
  }
  capture(
    raw: unknown,
    purpose?: "WASTE_TICKET" | "STORE_PHOTO",
    signal?: AbortSignal,
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
  ) {
    const task = this.tail.then(() =>
      this.run(raw, purpose, signal, authorize),
    );
    this.tail = task.catch(() => undefined);
    return task;
  }
  private async run(
    raw: unknown,
    purpose?: "WASTE_TICKET" | "STORE_PHOTO",
    signal?: AbortSignal,
    authorize?: (tx?: OutboxDatabase) => Promise<void>,
  ): Promise<EmailSourceHandoffResult> {
    const ref = emailIntakeOriginalRequestSchema.parse(raw);
    if (purpose !== undefined)
      z.enum(["WASTE_TICKET", "STORE_PHOTO"]).parse(purpose);
    let basis = await emailProcessingBasis(this.cache, ref, signal, authorize);
    const group = basis.receipt.files.filter((file) =>
      basis.decision.files.some(
        (selection) =>
          selection.fileId === file.id &&
          selection.processingId === basis.origin.processingId,
      ),
    );
    const anchor = group[0];
    if (!anchor) throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
    if (anchor.id !== ref.fileId)
      basis = await emailProcessingBasis(
        this.cache,
        { ...ref, fileId: anchor.id },
        signal,
        authorize,
      );
    const { scope, origin, decision, selection, database } = basis;
    if (selection.mode !== "AUTO" && purpose && purpose !== selection.mode)
      throw Error("EMAIL_INTAKE_PURPOSE_ALREADY_RECORDED");
    const prior = await this.cache.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM email_source_handoffs WHERE store_id=? AND owner_id=? AND conversation_id=? AND receipt_id=? AND processing_id=?",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
      origin.receiptId,
      origin.processingId,
    );
    await basis.authorize();
    const recorded = prior
      ? handoffSchema.parse(JSON.parse(prior.payload_json))
      : null;
    if (
      recorded &&
      (recorded.receiptId !== origin.receiptId ||
        recorded.actionId !== origin.actionId ||
        recorded.processingId !== origin.processingId)
    )
      throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
    const previousPurpose =
      recorded?.sourceType === "WASTE_RECEIPT"
        ? "WASTE_TICKET"
        : recorded?.sourceType === "STORE_PHOTO"
          ? "STORE_PHOTO"
          : undefined;
    if (purpose && previousPurpose && purpose !== previousPurpose)
      throw Error("EMAIL_INTAKE_PURPOSE_ALREADY_RECORDED");
    const mode =
      selection.mode === "AUTO" ? (purpose ?? previousPurpose) : selection.mode;
    const first = await verifiedEmailProcessingOriginal(
      basis,
      this.originals,
      this.dependencies.read,
      mode ? MAX_RECEIPT_VIEW_BYTES : MAX_COMMERCIAL_PDF_BYTES,
    );
    const firstMime = detectVisualImageMime(first.bytes);
    if (!mode && firstMime) return { status: "NEEDS_PURPOSE" };
    let kind: EmailSourceHandoffRecord["sourceType"];
    let file = {
      localUri: first.localUri,
      sizeBytes: first.manifest.sizeBytes,
      checksum: first.manifest.checksum,
      mimeType: "application/pdf",
      originalFilename: emailSourceFilename(
        basis.file.filename,
        "Document.pdf",
      ),
    };
    const inputs: EmailSourceHandoffRecord["inputs"] = [];
    const views: LocalReceiptPhotoView[] = [];
    if (!mode) {
      if (group.length !== 1) throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
      assertPdfHeader(first.bytes);
      kind = "WEEKLY_COMMERCIAL_PDF";
      inputs.push({
        fileId: basis.file.id,
        checksum: first.manifest.checksum,
        manifestHash: first.manifest.manifestHash,
      });
    } else {
      kind = mode === "WASTE_TICKET" ? "WASTE_RECEIPT" : "STORE_PHOTO";
      if (group.length > 1 && mode !== "WASTE_TICKET")
        throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
      let total = 0;
      const encoded = [];
      for (const selected of group) {
        const current =
          selected.id === basis.file.id
            ? basis
            : await emailProcessingBasis(
                this.cache,
                { ...ref, fileId: selected.id },
                signal,
                authorize,
              );
        if (
          current.selection.processingId !== origin.processingId ||
          current.decision.actionId !== origin.actionId ||
          (group.length > 1 && current.selection.mode !== "WASTE_TICKET")
        )
          throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
        const original =
          selected.id === basis.file.id
            ? first
            : await verifiedEmailProcessingOriginal(
                current,
                this.originals,
                this.dependencies.read,
                MAX_RECEIPT_VIEW_BYTES,
              );
        const mimeType = storePhotoMimeSchema.parse(
          detectVisualImageMime(original.bytes),
        );
        if (original.bytes.length > MAX_STORE_PHOTO_BYTES)
          throw Error("EMAIL_INTAKE_FILE_SIZE_INVALID");
        total += original.bytes.length;
        if (total > MAX_RECEIPT_ORIGINAL_BYTES)
          throw Error("COPILOT_RECEIPT_GROUP_SIZE_LIMIT");
        const { width, height } = await this.dependencies.imageSize(
          original.localUri,
        );
        await current.authorize();
        if (
          !Number.isSafeInteger(width) ||
          !Number.isSafeInteger(height) ||
          width <= 0 ||
          height <= 0 ||
          width * height > MAX_STORE_PHOTO_PIXELS
        )
          throw Error("EMAIL_INTAKE_IMAGE_INVALID");
        inputs.push({
          fileId: selected.id,
          checksum: original.manifest.checksum,
          manifestHash: original.manifest.manifestHash,
        });
        views.push({
          localUri: original.localUri,
          sizeBytes: original.manifest.sizeBytes,
          checksum: original.manifest.checksum,
          mimeType,
        });
        encoded.push({
          mimeType,
          sizeBytes: original.manifest.sizeBytes,
          checksum: original.manifest.checksum,
          dataBase64: base64(original.bytes),
        });
        if (group.length === 1)
          file = {
            ...file,
            mimeType,
            originalFilename: emailSourceFilename(selected.filename, "Photo"),
            localUri: original.localUri,
            sizeBytes: original.manifest.sizeBytes,
            checksum: original.manifest.checksum,
          };
      }
      if (group.length > 1) {
        const text = serializeReceiptPhotoBundle({
          schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
          mode: "ONE_RECEIPT_MULTIPLE_PHOTOS",
          views: encoded,
        });
        const bundled = await this.dependencies.bundle(
          text,
          emailProcessingIdentity(scope, origin, "LOCAL_FILE"),
        );
        await basis.authorize();
        if (
          !bundled.localUri.startsWith("file://") ||
          views.some((view) => view.localUri === bundled.localUri)
        )
          throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
        const bundleBytes = await this.dependencies.read(
          bundled.localUri,
          MAX_RECEIPT_BUNDLE_BYTES,
        );
        await basis.authorize();
        if (
          bundled.mimeType !== RECEIPT_PHOTO_BUNDLE_MIME ||
          bundled.sizeBytes !== text.length ||
          bundled.checksum !== sourceOriginalHash(text) ||
          bundleBytes.length !== bundled.sizeBytes ||
          sourceOriginalHash(bundleBytes) !== bundled.checksum
        )
          throw Error("EMAIL_INTAKE_ORIGINAL_CHANGED");
        file = {
          ...bundled,
          originalFilename: `Ticket de casse · ${group.length} vues`,
        };
        localReceiptPhotoViewsSchema.parse(views);
      }
    }
    const expected = {
      receiptId: origin.receiptId,
      actionId: origin.actionId,
      processingId: origin.processingId,
      sourceType: kind,
      sourceChecksum: file.checksum,
      inputs,
    };
    let record: EmailSourceHandoffRecord | undefined;
    await database.withExclusiveTransactionAsync(async (tx) => {
      for (const selected of group) {
        const current = await emailProcessingBasisOnTransaction(
          basis,
          tx,
          selected.id,
        );
        if (current.selection.processingId !== origin.processingId)
          throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
      }
      const previous = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM email_source_handoffs WHERE store_id=? AND owner_id=? AND conversation_id=? AND receipt_id=? AND processing_id=?",
        scope.storeId,
        scope.ownerId,
        scope.conversationId,
        origin.receiptId,
        origin.processingId,
      );
      const stored = previous
        ? handoffSchema.parse(JSON.parse(previous.payload_json))
        : null;
      if (
        stored &&
        (stored.receiptId !== expected.receiptId ||
          stored.actionId !== expected.actionId ||
          stored.processingId !== expected.processingId ||
          stored.sourceType !== kind ||
          stored.sourceChecksum !== file.checksum ||
          JSON.stringify(stored.inputs) !== JSON.stringify(inputs))
      )
        throw Error("EMAIL_INTAKE_PURPOSE_ALREADY_RECORDED");
      const repository = new SourceDocumentRepository(
        joinedMutationDatabase(tx),
      );
      let sourceDocumentId =
        stored?.sourceDocumentId ??
        emailProcessingIdentity(scope, origin, "SOURCE");
      const existing = await repository.getDocument(sourceDocumentId);
      let wasteReceiptId: string | null = null,
        duplicateCandidate = false;
      if (existing) {
        if (
          existing.storeId !== scope.storeId ||
          existing.sourceType !== kind ||
          existing.checksum !== file.checksum ||
          existing.deletedAt
        )
          throw Error("EMAIL_INTAKE_CANONICAL_SOURCE_CHANGED");
        if (kind === "WASTE_RECEIPT") {
          const receipt = await tx.getFirstAsync<{
            id: string;
            duplicate_status: string;
          }>(
            "SELECT id,duplicate_status FROM waste_receipts WHERE source_document_id=? AND store_id=? AND deleted_at IS NULL",
            sourceDocumentId,
            scope.storeId,
          );
          if (!receipt) throw Error("EMAIL_INTAKE_CANONICAL_SOURCE_CHANGED");
          wasteReceiptId = receipt.id;
          duplicateCandidate =
            receipt.duplicate_status === "POSSIBLE_DUPLICATE";
        }
      } else {
        if (stored) throw Error("EMAIL_INTAKE_CANONICAL_SOURCE_CHANGED");
        const fileId = emailProcessingIdentity(scope, origin, "LOCAL_FILE");
        if (kind === "WEEKLY_COMMERCIAL_PDF") {
          const result = await registerCommercialPdf(
            {
              storeId: scope.storeId,
              documentId: sourceDocumentId,
              fileId,
              originalFilename: file.originalFilename,
              capturedAt: decision.createdAt,
            },
            file,
            repository,
          );
          sourceDocumentId = result.document.id;
        } else if (kind === "STORE_PHOTO") {
          await repository.createCapturedStorePhoto({
            storeId: scope.storeId,
            ownerId: scope.ownerId,
            sourceDocumentId,
            fileId,
            capturedAt: decision.createdAt,
            file,
          });
        } else {
          const result = await new WasteReceiptRepository(
            joinedMutationDatabase(tx),
          ).createCapturedDraft({
            storeId: scope.storeId,
            sourceDocumentId,
            fileId,
            receiptId: emailProcessingIdentity(scope, origin, "RECEIPT"),
            uploadJobId: emailProcessingIdentity(scope, origin, "UPLOAD"),
            capturedAt: decision.createdAt,
            file,
          });
          wasteReceiptId = result.receipt.id;
          duplicateCandidate = !!result.duplicateCandidate;
          if (group.length > 1)
            await tx.runAsync(
              "INSERT INTO waste_receipt_photo_groups(source_document_id,store_id,checksum,payload_json) VALUES(?,?,?,?)",
              sourceDocumentId,
              scope.storeId,
              file.checksum,
              JSON.stringify(views),
            );
        }
      }
      record = handoffSchema.parse({
        ...expected,
        schemaVersion: 1,
        sourceDocumentId,
        wasteReceiptId,
        duplicateCandidate,
      });
      // The admitted source belongs to this conversation, using its ordinary attachment
      // channel. Never turn email prose into an instruction or schedule an AI turn.
      // Capture, source link and its Outbox append commit together; a retry reuses IDs.
      await new CopilotConversationRepository(
        joinedMutationDatabase(tx),
        scope,
      ).append(
        {
          id: emailProcessingIdentity(scope, origin, "MESSAGE"),
          ...scope,
          role: "USER",
          text: "Document reçu par email et confirmé dans cette conversation.",
          attachments: [
            {
              sourceDocumentId,
              filename: file.originalFilename,
              mediaType: file.mimeType,
            },
          ],
          replyToMessageId: null,
          supersedesMessageId: null,
          version: 1,
          createdAt: decision.createdAt,
        },
        {
          commandId: emailProcessingIdentity(scope, origin, "COMMAND"),
          deviceId: this.deviceId,
          preserveDraft: true,
        },
      );
      await tx.runAsync(
        "INSERT INTO email_source_handoffs(store_id,owner_id,conversation_id,receipt_id,processing_id,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(store_id,owner_id,conversation_id,receipt_id,processing_id) DO UPDATE SET payload_json=excluded.payload_json",
        scope.storeId,
        scope.ownerId,
        scope.conversationId,
        origin.receiptId,
        origin.processingId,
        JSON.stringify(record),
      );
    });
    if (!record) throw Error("EMAIL_INTAKE_HANDOFF_INTERRUPTED");
    if (!prior) notifyOutboxChanged();
    return { status: "CAPTURED", record };
  }
}

async function emailProcessingBasisOnTransaction(
  basis: EmailProcessingBasis,
  tx: OutboxDatabase,
  fileId: string,
) {
  await basis.cache.authorize(basis.scope, tx);
  const result = await readEmailProcessingAuthority(tx, basis.scope, {
    ...basis.origin,
    fileId,
  });
  basis.cache.check(basis.scope);
  return result;
}
