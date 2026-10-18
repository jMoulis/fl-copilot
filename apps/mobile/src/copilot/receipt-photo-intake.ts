import {
  copilotReceiptPhotoBatchSchema,
  MAX_COPILOT_RECEIPT_PHOTO_BYTES,
  MAX_COPILOT_RECEIPT_BATCH_BYTES,
  type CopilotDraft,
  type CopilotReceiptPhotoBatch,
} from "@fl-copilot/domain";
import { sourceUploadChecksumSchema } from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { CopilotConversationRepository } from "./conversation-repository";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import {
  persistWasteReceiptImport,
  resolveWasteReceiptImageExtension,
} from "../documents/waste-receipt-capture";
type Database = OutboxDatabase & AtomicMutationDatabase;
type Scope = { storeId: string; ownerId: string };
type Asset = CopilotReceiptPhotoBatch["assets"][number];
export interface ReceiptPhotoIntakeStorage {
  size(uri: string): Promise<number>;
  retain(
    asset: Asset,
    fileId: string,
  ): Promise<{
    localUri: string;
    sizeBytes: number;
    checksum: string;
    mimeType: string;
  }>;
}
export type ReceiptPhotoSelection = {
  draft: CopilotDraft | null;
  failures: Array<{ filename: string; code: string }>;
  imported: number;
};
/** The native picker authorizes capture only; each original remains a draft until reviewed/published. */
export class CopilotReceiptPhotoIntake {
  constructor(
    private readonly db: Database,
    private readonly scope: Scope,
    private readonly id: () => string,
    private readonly storage: ReceiptPhotoIntakeStorage = nativeReceiptPhotoIntakeStorage,
    private readonly now = () => new Date().toISOString(),
  ) {}
  async capture(
    conversationId: string,
    raw: CopilotReceiptPhotoBatch,
    authority: { canCapture(): boolean; signal: AbortSignal },
    capacity: number,
  ): Promise<ReceiptPhotoSelection> {
    const check = () => {
      if (authority.signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
      if (!authority.canCapture())
        throw Error("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
    };
    check();
    const input = copilotReceiptPhotoBatchSchema.parse(raw);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 10 ||
      input.assets.length > capacity
    )
      throw Error("COPILOT_ATTACHMENT_LIMIT");
    const repo = new CopilotConversationRepository(this.db, this.scope);
    await this.active(repo, conversationId);
    check();
    const draft = await repo.draft(conversationId);
    if ((draft?.attachments.length ?? 0) + input.assets.length > 10)
      throw Error("COPILOT_ATTACHMENT_LIMIT");
    let total = 0;
    const sizes: number[] = [];
    for (const asset of input.assets) {
      resolveWasteReceiptImageExtension({
        temporaryUri: asset.uri,
        mimeType: asset.mimeType,
        originalFilename: asset.filename,
      });
      const size = await this.storage.size(asset.uri);
      check();
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_COPILOT_RECEIPT_PHOTO_BYTES
      )
        throw Error("COPILOT_RECEIPT_PHOTO_SIZE_LIMIT");
      sizes.push(size);
      total += size;
      if (total > MAX_COPILOT_RECEIPT_BATCH_BYTES)
        throw Error("COPILOT_RECEIPT_BATCH_SIZE_LIMIT");
    }
    const result: ReceiptPhotoSelection = { draft, failures: [], imported: 0 };
    for (const [index, asset] of input.assets.entries()) {
      check();
      const receiptId = this.id(),
        sourceDocumentId = this.id(),
        fileId = this.id(),
        uploadJobId = this.id(),
        capturedAt = this.now();
      try {
        const retained = await this.storage.retain(asset, fileId);
        check();
        sourceUploadChecksumSchema.parse(retained.checksum);
        const extension = resolveWasteReceiptImageExtension({
          temporaryUri: asset.uri,
          mimeType: asset.mimeType,
          originalFilename: asset.filename,
        });
        if (
          retained.sizeBytes !== sizes[index] ||
          retained.mimeType !==
            (extension === "jpg" ? "image/jpeg" : `image/${extension}`) ||
          retained.localUri === asset.uri
        )
          throw Error("COPILOT_RECEIPT_PHOTO_NOT_SAVED");
        if (
          !Number.isSafeInteger(retained.sizeBytes) ||
          retained.sizeBytes <= 0 ||
          retained.sizeBytes > MAX_COPILOT_RECEIPT_PHOTO_BYTES
        )
          throw Error("COPILOT_RECEIPT_PHOTO_SIZE_LIMIT");
        // No selected original is removed; a copy with uncertain commit outcome is retained.
        await this.db.withExclusiveTransactionAsync(async (tx) => {
          const joined = {
            ...tx,
            getFirstAsync: tx.getFirstAsync.bind(tx),
            getAllAsync: tx.getAllAsync.bind(tx),
            runAsync: tx.runAsync.bind(tx),
            withExclusiveTransactionAsync: (
              work: (t: OutboxDatabase) => Promise<void>,
            ) => work(tx),
          };
          const conversations = new CopilotConversationRepository(
            joined,
            this.scope,
          );
          check();
          await this.active(conversations, conversationId);
          await new WasteReceiptRepository(joined).createCapturedDraft({
            receiptId,
            sourceDocumentId,
            fileId,
            uploadJobId,
            storeId: this.scope.storeId,
            capturedAt,
            file: { ...retained, originalFilename: asset.filename },
          });
          result.draft = await conversations.attachReceiptPhotos(
            conversationId,
            [sourceDocumentId],
            capturedAt,
            authority.signal,
          );
          check();
        });
        result.imported++;
      } catch (error) {
        check();
        await this.active(repo, conversationId);
        const code =
          error instanceof Error &&
          [
            "COPILOT_ATTACHMENT_LIMIT",
            "COPILOT_RECEIPT_PHOTO_SIZE_LIMIT",
          ].includes(error.message)
            ? error.message
            : "COPILOT_RECEIPT_PHOTO_NOT_SAVED";
        result.failures.push({ filename: asset.filename, code });
      }
    }
    result.draft = await repo.draft(conversationId);
    check();
    return result;
  }
  private async active(repo: CopilotConversationRepository, id: string) {
    const c = await repo.get(id);
    if (!c || c.status !== "ACTIVE" || c.deletedAt)
      throw Error("COPILOT_CONVERSATION_UNAVAILABLE");
  }
}
export const nativeReceiptPhotoIntakeStorage: ReceiptPhotoIntakeStorage = {
  async size(uri) {
    const { File } = await import("expo-file-system");
    const f = new File(uri);
    if (!f.exists) throw Error("COPILOT_RECEIPT_PHOTO_MISSING");
    return f.size;
  },
  async retain(asset, fileId) {
    return persistWasteReceiptImport({
      temporaryUri: asset.uri,
      captureId: fileId,
      mimeType: asset.mimeType,
      originalFilename: asset.filename,
    });
  },
};
