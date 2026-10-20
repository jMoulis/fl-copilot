import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import {
  readStorePhotoOriginal,
  type StorePhotoOriginalStorage,
} from "./store-photo-original";

async function fixture() {
  const db = new DatabaseSync(":memory:"),
    adapter = new ReceiptTestDatabase(db);
  await runLocalMigrations(adapter);
  const storeId = randomUUID(),
    id = randomUUID(),
    at = "2026-10-20T12:00:00.000Z",
    bytes = new Uint8Array([255, 216, 255, 16, 255, 217]);
  const checksum = async (bytes: Uint8Array) =>
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    hash = await checksum(bytes);
  await new SourceDocumentRepository(adapter).createStorePhoto({
    document: {
      id,
      storeId,
      sourceType: "STORE_PHOTO",
      originalFilename: "rayon.jpg",
      checksum: hash,
      localFileUri: "file:///old-container/store-photos/rayon.jpg",
      localProcessingStatus: "VALIDATED",
      remoteUploadStatus: "LOCAL_ONLY",
      version: 1,
      createdAt: at,
      updatedAt: at,
      syncState: "LOCAL_ONLY",
      remoteVersion: null,
      dirty: true,
    },
    file: {
      id: randomUUID(),
      storeId,
      sourceDocumentId: id,
      localUri: "file:///old-container/store-photos/rayon.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      checksum: hash,
      retentionStatus: "RETAINED",
      uploadStatus: "LOCAL_ONLY",
      createdAt: at,
      updatedAt: at,
    },
  });
  const file = {
    uri: "file:///new-container/store-photos/rayon.jpg",
    bytes,
    width: 32,
    height: 24,
  };
  const storage: StorePhotoOriginalStorage = {
    read: vi.fn(async () => file),
    checksum,
  };
  return { db, adapter, storeId, id, file, storage };
}
it("verifies the retained original even after an iOS container relocation without rewriting source metadata", async () => {
  const f = await fixture();
  try {
    expect(
      await readStorePhotoOriginal(f.adapter, f.storeId, f.id, f.storage),
    ).toBe(f.file.uri);
    expect(
      f.db.prepare("SELECT local_file_uri FROM source_documents").get(),
    ).toEqual({
      local_file_uri: "file:///old-container/store-photos/rayon.jpg",
    });
    expect(f.storage.read).toHaveBeenCalledWith(
      "file:///old-container/store-photos/rayon.jpg",
      f.file.bytes.length,
    );
  } finally {
    f.db.close();
  }
});
it.each([
  "foreign",
  "retired",
  "receipt",
  "removed",
  "mismatched-file",
  "oversized-metadata",
])("does not read private pixels from a %s source", async (mode) => {
  const f = await fixture();
  try {
    if (mode === "retired")
      f.db.exec(
        "UPDATE source_documents SET deleted_at='2026-10-20T12:01:00Z'",
      );
    if (mode === "receipt")
      f.db.exec("UPDATE source_documents SET source_type='WASTE_RECEIPT'");
    if (mode === "removed")
      f.db.exec("UPDATE local_files SET retention_status='REMOVED'");
    if (mode === "mismatched-file")
      f.db.exec("UPDATE local_files SET checksum='sha256:other'");
    if (mode === "oversized-metadata")
      f.db.exec("UPDATE local_files SET size_bytes=100000000");
    await expect(
      readStorePhotoOriginal(
        f.adapter,
        mode === "foreign" ? randomUUID() : f.storeId,
        f.id,
        f.storage,
      ),
    ).rejects.toThrow("STORE_PHOTO_ORIGINAL_UNAVAILABLE");
    expect(f.storage.read).not.toHaveBeenCalled();
  } finally {
    f.db.close();
  }
});
it.each(["missing", "tampered", "wrong-mime", "pixels", "withdrawn"])(
  "refuses %s original pixels",
  async (mode) => {
    const f = await fixture();
    try {
      if (mode === "missing") f.storage.read = vi.fn(async () => null);
      if (mode === "tampered") f.file.bytes[3] ^= 1;
      if (mode === "wrong-mime")
        f.db.exec("UPDATE local_files SET mime_type='image/png'");
      if (mode === "pixels") f.file.width = f.file.height = 7000;
      if (mode === "withdrawn")
        f.storage.read = vi.fn(async () => {
          f.db.exec(
            "UPDATE source_documents SET deleted_at='2026-10-20T12:01:00Z'",
          );
          return f.file;
        });
      await expect(
        readStorePhotoOriginal(f.adapter, f.storeId, f.id, f.storage),
      ).rejects.toThrow(/STORE_PHOTO_ORIGINAL/);
    } finally {
      f.db.close();
    }
  },
);
