import {
  MAX_MERCALYS_BATCH_BYTES,
  MAX_MERCALYS_BATCH_FILE_BYTES,
  MAX_MERCALYS_BATCH_FILES,
  retainedMercalysBatchFileSchema,
  type MercalysBatchInput,
} from "@fl-copilot/domain";
import type { MercalysBatchRepository } from "./mercalys-batch-repository";
export type MercalysSelectedFile = { name: string; uri: string };
export interface MercalysBatchStorage {
  size(uri: string): Promise<number>;
  retain(
    uri: string,
    id: string,
  ): Promise<{ localUri: string; sizeBytes: number; checksum: string }>;
}
/** Persist originals before parsing; cancellation still records the already retained prefix. */
export async function captureMercalysBatch(
  input: { files: MercalysSelectedFile[]; storeId: string; ownerId: string },
  repository: MercalysBatchRepository,
  storage: MercalysBatchStorage,
  id: () => string,
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
) {
  if (
    input.storeId !== repository.storeId ||
    input.ownerId !== repository.ownerId
  )
    throw Error("MERCALYS_BATCH_SCOPE_INVALID");
  if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
  if (!input.files.length || input.files.length > MAX_MERCALYS_BATCH_FILES)
    throw Error("MERCALYS_BATCH_LIMIT");
  let totalBytes = 0;
  for (const file of input.files) {
    retainedMercalysBatchFileSchema.shape.filename.parse(file.name);
    const size = await storage.size(file.uri);
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAX_MERCALYS_BATCH_FILE_BYTES
    )
      throw Error("MERCALYS_BATCH_SIZE_LIMIT");
    totalBytes += size;
    if (totalBytes > MAX_MERCALYS_BATCH_BYTES)
      throw Error("MERCALYS_BATCH_SIZE_LIMIT");
    if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
  }
  const batch: MercalysBatchInput = {
    id: id(),
    storeId: input.storeId,
    ownerId: input.ownerId,
    conversationId: null,
    createdAt: new Date().toISOString(),
    files: [],
  };
  const failures: string[] = [];
  for (const file of input.files) {
    if (signal?.aborted) break;
    const itemId = id();
    try {
      const retained = await storage.retain(file.uri, itemId);
      batch.files.push(
        retainedMercalysBatchFileSchema.parse({
          id: itemId,
          filename: file.name,
          ...retained,
        }),
      );
    } catch {
      failures.push(file.name);
    }
    onProgress?.(batch.files.length + failures.length, input.files.length);
  }
  if (batch.files.length) await repository.create(batch);
  if (signal?.aborted) throw Error("MERCALYS_BATCH_CANCELLED");
  return { batchId: batch.files.length ? batch.id : null, failures };
}
export const nativeMercalysBatchStorage: MercalysBatchStorage = {
  async size(uri) {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    if (!file.exists) throw Error("MERCALYS_BATCH_FILE_MISSING");
    return file.size;
  },
  async retain(uri, id) {
    const { File, Directory, Paths } = await import("expo-file-system");
    const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
    const source = new File(uri);
    if (
      !source.exists ||
      source.size <= 0 ||
      source.size > MAX_MERCALYS_BATCH_FILE_BYTES
    )
      throw Error("MERCALYS_BATCH_SIZE_LIMIT");
    const directory = new Directory(Paths.document, "mercalys-batches");
    directory.create({ idempotent: true, intermediates: true });
    const copy = new File(directory, `${id}.xlsx`);
    if (copy.exists) throw Error("MERCALYS_BATCH_COPY_EXISTS");
    await source.copy(copy);
    const bytes = await copy.bytes();
    if (
      bytes.length !== source.size ||
      bytes.length > MAX_MERCALYS_BATCH_FILE_BYTES
    )
      throw Error("MERCALYS_BATCH_COPY_FAILED");
    const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
    return {
      localUri: copy.uri,
      sizeBytes: bytes.byteLength,
      checksum: `sha256:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`,
    };
  },
};
