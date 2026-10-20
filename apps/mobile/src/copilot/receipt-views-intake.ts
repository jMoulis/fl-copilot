import {
  copilotReceiptViewsSelectionSchema,
  serializeReceiptPhotoBundle,
  RECEIPT_PHOTO_BUNDLE_MIME,
  RECEIPT_PHOTO_BUNDLE_VERSION,
  MAX_RECEIPT_VIEW_BYTES,
  MAX_RECEIPT_ORIGINAL_BYTES,
  MAX_RECEIPT_BUNDLE_BYTES,
  type CopilotReceiptViewsSelection,
} from "@fl-copilot/domain";
import { sourceUploadChecksumSchema } from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { CopilotConversationRepository } from "./conversation-repository";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import {
  localReceiptPhotoViewsSchema,
  type LocalReceiptPhotoView,
} from "../documents/receipt-photo-views";
import { resolveWasteReceiptImageExtension } from "../documents/waste-receipt-capture";
import {
  nativeReceiptPhotoIntakeStorage,
  type ReceiptPhotoIntakeStorage,
  type ReceiptPhotoSelection,
} from "./receipt-photo-intake";
type Retained = Awaited<ReturnType<ReceiptPhotoIntakeStorage["retain"]>>;
export interface ReceiptViewsIntakeStorage extends ReceiptPhotoIntakeStorage {
  read(
    uri: string,
  ): Promise<{ dataBase64: string; checksum: string; sizeBytes: number }>;
  writeBundle(text: string, fileId: string): Promise<Retained>;
}
export class CopilotReceiptViewsIntake {
  constructor(
    private readonly db: OutboxDatabase & AtomicMutationDatabase,
    private readonly scope: { storeId: string; ownerId: string },
    private readonly id: () => string,
    private readonly storage: ReceiptViewsIntakeStorage = nativeReceiptViewsIntakeStorage,
    private readonly now = () => new Date().toISOString(),
  ) {}
  async capture(
    conversationId: string,
    raw: CopilotReceiptViewsSelection,
    authority: { canCapture(): boolean; signal: AbortSignal },
    capacity: number,
  ): Promise<ReceiptPhotoSelection> {
    const check = () => {
      if (authority.signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
      if (!authority.canCapture())
        throw Error("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
    };
    check();
    const input = copilotReceiptViewsSelectionSchema.parse(raw);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10)
      throw Error("COPILOT_ATTACHMENT_LIMIT");
    const repo = new CopilotConversationRepository(this.db, this.scope);
    const active = async (r: CopilotConversationRepository) => {
      const c = await r.get(conversationId);
      if (!c || c.status !== "ACTIVE" || c.deletedAt)
        throw Error("COPILOT_CONVERSATION_UNAVAILABLE");
      if ((await r.draft(conversationId))?.attachments.length === 10)
        throw Error("COPILOT_ATTACHMENT_LIMIT");
      check();
    };
    await active(repo);
    let total = 0;
    const sizes: number[] = [];
    for (const asset of input.assets) {
      resolveWasteReceiptImageExtension({
        temporaryUri: asset.uri,
        originalFilename: asset.filename,
        mimeType: asset.mimeType,
      });
      const size = await this.storage.size(asset.uri);
      check();
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_RECEIPT_VIEW_BYTES
      )
        throw Error("COPILOT_RECEIPT_PHOTO_SIZE_LIMIT");
      total += size;
      sizes.push(size);
    }
    if (total > MAX_RECEIPT_ORIGINAL_BYTES)
      throw Error("COPILOT_RECEIPT_GROUP_SIZE_LIMIT");
    const views: LocalReceiptPhotoView[] = [],
      encoded = [];
    for (const [index, asset] of input.assets.entries()) {
      const view = await this.storage.retain(asset, this.id());
      check();
      const extension = resolveWasteReceiptImageExtension({
        temporaryUri: asset.uri,
        originalFilename: asset.filename,
        mimeType: asset.mimeType,
      });
      const mimeType: LocalReceiptPhotoView["mimeType"] =
        extension === "jpg"
          ? "image/jpeg"
          : (`image/${extension}` as "image/png" | "image/heic" | "image/heif");
      if (
        view.localUri === asset.uri ||
        view.sizeBytes !== sizes[index] ||
        view.mimeType !== mimeType
      )
        throw Error("COPILOT_RECEIPT_PHOTO_NOT_SAVED");
      const actual = await this.storage.read(view.localUri);
      check();
      if (
        actual.checksum !== view.checksum ||
        actual.sizeBytes !== view.sizeBytes
      )
        throw Error("COPILOT_RECEIPT_PHOTO_NOT_SAVED");
      views.push({
        localUri: view.localUri,
        sizeBytes: view.sizeBytes,
        checksum: view.checksum,
        mimeType,
      });
      encoded.push({
        mimeType,
        sizeBytes: view.sizeBytes,
        checksum: view.checksum,
        dataBase64: actual.dataBase64,
      });
    }
    localReceiptPhotoViewsSchema.parse(views);
    const text = serializeReceiptPhotoBundle({
      schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
      mode: "ONE_RECEIPT_MULTIPLE_PHOTOS",
      views: encoded,
    });
    const receiptId = this.id(),
      sourceDocumentId = this.id(),
      fileId = this.id(),
      uploadJobId = this.id();
    const file = await this.storage.writeBundle(text, fileId);
    check();
    sourceUploadChecksumSchema.parse(file.checksum);
    if (
      file.mimeType !== RECEIPT_PHOTO_BUNDLE_MIME ||
      file.sizeBytes !== text.length ||
      file.sizeBytes > MAX_RECEIPT_BUNDLE_BYTES ||
      views.some((view) => view.localUri === file.localUri)
    )
      throw Error("COPILOT_RECEIPT_PHOTO_NOT_SAVED");
    const capturedAt = this.now();
    let draft = null;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const joined = {
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
      await active(conversations);
      await new WasteReceiptRepository(joined).createCapturedDraft({
        receiptId,
        sourceDocumentId,
        fileId,
        uploadJobId,
        storeId: this.scope.storeId,
        capturedAt,
        file: {
          ...file,
          originalFilename: `Ticket de casse · ${views.length} vues`,
        },
      });
      await tx.runAsync(
        "INSERT INTO waste_receipt_photo_groups(source_document_id,store_id,checksum,payload_json) VALUES(?,?,?,?)",
        sourceDocumentId,
        this.scope.storeId,
        file.checksum,
        JSON.stringify(views),
      );
      draft = await conversations.attachReceiptPhotos(
        conversationId,
        [sourceDocumentId],
        capturedAt,
        authority.signal,
      );
      check();
    });
    return { draft, failures: [], imported: 1 };
  }
}
const checksumOf = async (bytes: Uint8Array) => {
  const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
  return `sha256:${Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))), (n) => n.toString(16).padStart(2, "0")).join("")}`;
};
export const nativeReceiptViewsIntakeStorage: ReceiptViewsIntakeStorage = {
  ...nativeReceiptPhotoIntakeStorage,
  async read(uri) {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    const bytes = await file.bytes();
    const dataBase64 = await file.base64();
    return {
      dataBase64,
      checksum: await checksumOf(bytes),
      sizeBytes: bytes.length,
    };
  },
  async writeBundle(text, fileId) {
    const { File, Directory, Paths } = await import("expo-file-system");
    const directory = new Directory(Paths.document, "waste-receipts");
    directory.create({ idempotent: true, intermediates: true });
    const file = new File(directory, `${fileId}.flreceipt`);
    const expected = await checksumOf(new TextEncoder().encode(text));
    if (!file.exists) {
      const { randomUUID } = await import("expo-crypto");
      const partial = new File(directory, `${fileId}.${randomUUID()}.part`);
      try {
        partial.create();
        partial.write(text);
        if (
          partial.size !== text.length ||
          (await checksumOf(await partial.bytes())) !== expected
        )
          throw Error("COPILOT_RECEIPT_PHOTO_NOT_SAVED");
        await partial.move(file);
      } finally {
        if (partial.exists && partial.uri !== file.uri) partial.delete();
      }
    }
    const bytes = await file.bytes();
    if (bytes.length !== text.length || (await checksumOf(bytes)) !== expected)
      throw Error("COPILOT_RECEIPT_PHOTO_NOT_SAVED");
    return {
      localUri: file.uri,
      mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
      sizeBytes: bytes.length,
      checksum: await checksumOf(bytes),
    };
  },
};
