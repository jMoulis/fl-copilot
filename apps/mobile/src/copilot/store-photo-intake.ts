import {
  MAX_STORE_PHOTO_BYTES,
  MAX_STORE_PHOTO_PIXELS,
  MAX_STORE_PHOTOS_PER_TURN,
  detectVisualImageMime,
  storePhotoSelectionSchema,
  type StorePhotoSelection,
  type CopilotDraft,
} from "@fl-copilot/domain";
import { sourceUploadChecksumSchema } from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  nativeImageCaptureStorage,
  persistWasteReceiptImport,
} from "../documents/waste-receipt-capture";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import { CopilotConversationRepository } from "./conversation-repository";

type Database = OutboxDatabase & AtomicMutationDatabase;
type Scope = { storeId: string; ownerId: string };
export type StorePhotoIntakeResult = {
  draft: CopilotDraft | null;
  imported: number;
  failures: { filename: string; code: string }[];
};
export interface StorePhotoIntakeStorage {
  size(uri: string): Promise<number>;
  retain(
    asset: StorePhotoSelection["assets"][number],
    id: string,
  ): Promise<{
    localUri: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  }>;
}
export class CopilotStorePhotoIntake {
  constructor(
    private readonly db: Database,
    private readonly scope: Scope,
    private readonly id: () => string,
    private readonly storage: StorePhotoIntakeStorage = nativeStorage,
    private readonly now = () => new Date().toISOString(),
  ) {}
  async capacity(conversationId: string) {
    const repo = new CopilotConversationRepository(this.db, this.scope);
    await this.active(repo, conversationId);
    const draft = await repo.draft(conversationId);
    let photos = 0;
    for (const attachment of draft?.attachments ?? []) {
      if (
        await this.db.getFirstAsync(
          "SELECT id FROM source_documents WHERE id=? AND store_id=? AND source_type='STORE_PHOTO' AND deleted_at IS NULL",
          attachment.sourceDocumentId,
          this.scope.storeId,
        )
      )
        photos++;
    }
    return Math.max(
      0,
      Math.min(
        10 - (draft?.attachments.length ?? 0),
        MAX_STORE_PHOTOS_PER_TURN - photos,
      ),
    );
  }
  async capture(
    conversationId: string,
    raw: StorePhotoSelection,
    authority: { canCapture(): boolean; signal: AbortSignal },
    capacity: number,
  ): Promise<StorePhotoIntakeResult> {
    const check = () => {
      if (authority.signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
      if (!authority.canCapture()) throw Error("STORE_PHOTO_CAPTURE_FORBIDDEN");
    };
    check();
    const input = storePhotoSelectionSchema.parse(raw),
      repo = new CopilotConversationRepository(this.db, this.scope);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      input.assets.length > capacity ||
      input.assets.length > (await this.capacity(conversationId))
    )
      throw Error("STORE_PHOTO_TURN_LIMIT");
    const sizes: number[] = [];
    for (const asset of input.assets) {
      const size = await this.storage.size(asset.uri);
      check();
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_STORE_PHOTO_BYTES
      )
        throw Error("STORE_PHOTO_SIZE_LIMIT");
      sizes.push(size);
    }
    const result: StorePhotoIntakeResult = {
      draft: await repo.draft(conversationId),
      failures: [],
      imported: 0,
    };
    for (const [index, asset] of input.assets.entries()) {
      check();
      const sourceDocumentId = this.id(),
        fileId = this.id(),
        at = this.now();
      try {
        const retained = await this.storage.retain(asset, fileId);
        check();
        sourceUploadChecksumSchema.parse(retained.checksum);
        if (
          retained.sizeBytes !== sizes[index] ||
          retained.mimeType !== asset.mimeType ||
          retained.localUri === asset.uri ||
          !retained.localUri.startsWith("file://")
        )
          throw Error("STORE_PHOTO_NOT_SAVED");
        let next: CopilotDraft | undefined;
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
          await new SourceDocumentRepository(joined).createCapturedStorePhoto({
            sourceDocumentId,
            fileId,
            storeId: this.scope.storeId,
            ownerId: this.scope.ownerId,
            capturedAt: at,
            file: { ...retained, originalFilename: asset.filename },
          });
          next = await conversations.attachStorePhotos(
            conversationId,
            [sourceDocumentId],
            at,
            authority.signal,
          );
          check();
        });
        result.draft = next!;
        result.imported++;
      } catch (error) {
        // Keep selected originals and uncertain app-owned copies; never delete on a failed commit.
        check();
        await this.active(repo, conversationId);
        result.failures.push({
          filename: asset.filename,
          code:
            error instanceof Error &&
            ["STORE_PHOTO_SIZE_LIMIT", "STORE_PHOTO_TURN_LIMIT"].includes(
              error.message,
            )
              ? error.message
              : "STORE_PHOTO_NOT_SAVED",
        });
      }
    }
    return result;
  }
  private async active(repo: CopilotConversationRepository, id: string) {
    const conversation = await repo.get(id);
    if (!conversation || conversation.status !== "ACTIVE")
      throw Error("COPILOT_CONVERSATION_UNAVAILABLE");
  }
}
const nativeStorage: StorePhotoIntakeStorage = {
  async size(uri) {
    const { File } = await import("expo-file-system");
    const f = new File(uri);
    return f.exists ? f.size : 0;
  },
  async retain(asset, id) {
    const saved = await persistWasteReceiptImport(
      {
        temporaryUri: asset.uri,
        captureId: id,
        mimeType: asset.mimeType,
        originalFilename: asset.filename,
      },
      nativeImageCaptureStorage("store-photos", MAX_STORE_PHOTO_BYTES),
    );
    const { File } = await import("expo-file-system");
    if (
      detectVisualImageMime(await new File(saved.localUri).bytes()) !==
      asset.mimeType
    )
      throw Error("STORE_PHOTO_INVALID");
    const { readNativeImageSize } = await import("../media/image-size");
    const { width, height } = await readNativeImageSize(saved.localUri);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > MAX_STORE_PHOTO_PIXELS
    )
      throw Error("STORE_PHOTO_INVALID");
    return saved;
  },
};
