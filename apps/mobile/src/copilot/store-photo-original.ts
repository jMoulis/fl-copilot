import {
  MAX_STORE_PHOTO_BYTES,
  MAX_STORE_PHOTO_PIXELS,
  detectVisualImageMime,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
export interface StorePhotoOriginalStorage {
  read(
    uri: string,
    maximumBytes: number,
  ): Promise<{
    uri: string;
    bytes: Uint8Array;
    width: number;
    height: number;
  } | null>;
  checksum(bytes: Uint8Array): Promise<string>;
}
/** Read-only proof of the retained original; no automatic replacement or metadata mutation. */
export async function readStorePhotoOriginal(
  db: OutboxDatabase,
  storeId: string,
  id: string,
  storage: StorePhotoOriginalStorage = nativeStorage,
) {
  const lookup = () =>
    db.getAllAsync<{
      local_uri: string;
      checksum: string;
      mime_type: string;
      size_bytes: number;
    }>(
      "SELECT f.local_uri,f.checksum,f.mime_type,f.size_bytes FROM local_files f JOIN source_documents d ON d.id=f.source_document_id AND d.store_id=f.store_id AND d.checksum=f.checksum AND d.local_file_uri=f.local_uri WHERE d.id=? AND d.store_id=? AND d.source_type='STORE_PHOTO' AND d.deleted_at IS NULL AND f.retention_status='RETAINED' LIMIT 2",
      id,
      storeId,
    );
  const rows = await lookup(),
    file = rows.length === 1 ? rows[0] : undefined;
  if (
    !file ||
    !Number.isSafeInteger(file.size_bytes) ||
    file.size_bytes <= 0 ||
    file.size_bytes > MAX_STORE_PHOTO_BYTES ||
    !file.local_uri.startsWith("file://")
  )
    throw Error("STORE_PHOTO_ORIGINAL_UNAVAILABLE");
  const read = await storage.read(file.local_uri, file.size_bytes);
  if (
    !read ||
    !read.uri.startsWith("file://") ||
    read.bytes.length !== file.size_bytes ||
    detectVisualImageMime(read.bytes) !== file.mime_type ||
    (await storage.checksum(read.bytes)) !== file.checksum ||
    !Number.isSafeInteger(read.width) ||
    !Number.isSafeInteger(read.height) ||
    read.width <= 0 ||
    read.height <= 0 ||
    read.width * read.height > MAX_STORE_PHOTO_PIXELS
  )
    throw Error("STORE_PHOTO_ORIGINAL_UNAVAILABLE");
  if (JSON.stringify(await lookup()) !== JSON.stringify(rows))
    throw Error("STORE_PHOTO_ORIGINAL_CHANGED");
  return read.uri;
}
const nativeStorage: StorePhotoOriginalStorage = {
  async read(uri, maximumBytes) {
    const { File, Paths } = await import("expo-file-system");
    let file = new File(uri);
    if (!file.exists)
      file = new File(Paths.document, "store-photos", Paths.parse(uri).base);
    if (
      !file.exists ||
      file.size <= 0 ||
      file.size > maximumBytes ||
      file.size > MAX_STORE_PHOTO_BYTES
    )
      return null;
    const bytes = await file.bytes();
    if (
      bytes.length > maximumBytes ||
      bytes.length > MAX_STORE_PHOTO_BYTES ||
      !detectVisualImageMime(bytes)
    )
      return null;
    const { Image } = await import("react-native"),
      dimensions = await Image.getSize(file.uri);
    return { uri: file.uri, bytes, ...dimensions };
  },
  async checksum(bytes) {
    const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
    return `sha256:${Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  },
};
