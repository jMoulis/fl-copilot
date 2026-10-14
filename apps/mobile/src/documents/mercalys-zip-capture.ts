import {
  MAX_MERCALYS_BATCH_BYTES,
  mercalysArchiveInputSchema,
  retainedMercalysBatchFileSchema,
  type MercalysArchiveInput,
  type MercalysBatchInput,
} from "@fl-copilot/domain";
import {
  createMercalysZipReader,
  MercalysZipError,
} from "@fl-copilot/import-core";
import type { MercalysArchiveRepository } from "./mercalys-archive-repository";
import type { MercalysBatchRepository } from "./mercalys-batch-repository";
export interface MercalysZipStorage {
  retain(
    uri: string,
    id: string,
  ): Promise<{ localUri: string; sizeBytes: number; checksum: string }>;
  read(uri: string): Promise<Uint8Array<ArrayBuffer>>;
  checksum(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
  member(
    bytes: Uint8Array<ArrayBuffer>,
    id: string,
  ): Promise<{ localUri: string; sizeBytes: number; checksum: string }>;
  memberId(parentId: string, path: string): Promise<string>;
  pause(): Promise<void>;
}
export async function retainMercalysZip(
  asset: { name: string; uri: string },
  archives: MercalysArchiveRepository,
  storage: MercalysZipStorage,
  id: () => string,
  signal?: AbortSignal,
) {
  await archives.assertConversation();
  if (signal?.aborted) throw new MercalysZipError("CANCELLED");
  mercalysArchiveInputSchema.shape.filename.parse(asset.name);
  const archiveId = mercalysArchiveInputSchema.shape.id.parse(id()),
    retained = await storage.retain(asset.uri, archiveId);
  const input: MercalysArchiveInput = {
    id: archiveId,
    batchId: id(),
    ...archives.scope,
    filename: asset.name,
    ...retained,
    createdAt: new Date().toISOString(),
  };
  await archives.create(input);
  return archiveId;
}
/** Stable child IDs and append-only membership recover already retained copies after interruption. */
export async function extractRetainedMercalysZip(
  archiveId: string,
  archives: MercalysArchiveRepository,
  batches: MercalysBatchRepository,
  storage: MercalysZipStorage,
  signal?: AbortSignal,
) {
  const a = await archives.get(archiveId);
  if (a.storeId !== batches.storeId || a.ownerId !== batches.ownerId)
    throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
  const cancel = () => {
    if (signal?.aborted) throw new MercalysZipError("CANCELLED");
  };
  cancel();
  const files: MercalysBatchInput["files"] = [],
    failures: Array<{ path: string; code: string }> = [];
  let ignored: string[] = [];
  let fatal: string | undefined;
  let interrupted = false;
  try {
    const bytes = await storage.read(a.localUri);
    cancel();
    if (
      bytes.length !== a.sizeBytes ||
      (await storage.checksum(bytes)) !== a.checksum
    )
      throw Error("MERCALYS_ARCHIVE_FILE_CHANGED");
    cancel();
    const reader = createMercalysZipReader(bytes);
    ignored = [...reader.ignored];
    for (const entry of reader.files) {
      cancel();
      try {
        const decoded = await reader.extract(entry.path, {
          signal,
          pause: () => storage.pause(),
        });
        cancel();
        const id = retainedMercalysBatchFileSchema.shape.id.parse(
            await storage.memberId(a.id, entry.path),
          ),
          copy = await storage.member(decoded, id);
        files.push(
          retainedMercalysBatchFileSchema.parse({
            id,
            filename: entry.path,
            ...copy,
          }),
        );
      } catch (reason) {
        cancel();
        failures.push({
          path: entry.path,
          code:
            reason instanceof MercalysZipError
              ? reason.message
              : "MERCALYS_ZIP_COPY_FAILED",
        });
      }
    }
  } catch (reason) {
    if (reason instanceof MercalysZipError && reason.code === "CANCELLED")
      interrupted = true;
    else
      fatal =
        reason instanceof MercalysZipError
          ? reason.message
          : reason instanceof Error &&
              reason.message === "MERCALYS_ARCHIVE_FILE_CHANGED"
            ? reason.message
            : "MERCALYS_ZIP_EXTRACTION_FAILED";
  }
  if (files.length)
    await batches.appendArchive({
      id: a.batchId,
      storeId: a.storeId,
      ownerId: a.ownerId,
      archiveId: a.id,
      conversationId: a.conversationId ?? null,
      createdAt: a.createdAt,
      files,
    });
  if (interrupted || signal?.aborted) throw new MercalysZipError("CANCELLED");
  return archives.finish(
    a.id,
    a.version,
    fatal
      ? { status: "FAILED", code: fatal }
      : { status: "PROCESSED", retainedCount: files.length, failures, ignored },
  );
}
export const nativeMercalysZipStorage: MercalysZipStorage = {
  async retain(uri, id) {
    const { File, Directory, Paths } = await import("expo-file-system");
    const source = new File(uri);
    if (
      !source.exists ||
      source.size <= 0 ||
      source.size > MAX_MERCALYS_BATCH_BYTES
    )
      throw new MercalysZipError("LIMIT");
    const d = new Directory(Paths.document, "mercalys-archives");
    d.create({ idempotent: true, intermediates: true });
    const copy = new File(d, `${id}.zip`);
    if (copy.exists) throw Error("MERCALYS_ARCHIVE_COPY_EXISTS");
    const expectedSize = source.size;
    await source.copy(copy);
    const bytes = await copy.bytes();
    if (bytes.length !== expectedSize)
      throw Error("MERCALYS_ARCHIVE_COPY_FAILED");
    return {
      localUri: copy.uri,
      sizeBytes: bytes.length,
      checksum: await this.checksum(bytes),
    };
  },
  async read(uri) {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    if (!file.exists || file.size <= 0 || file.size > MAX_MERCALYS_BATCH_BYTES)
      throw new MercalysZipError("LIMIT");
    return file.bytes();
  },
  async checksum(bytes) {
    const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
    const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
    return `sha256:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  },
  async member(bytes, id) {
    const { File, Directory, Paths } = await import("expo-file-system");
    const d = new Directory(Paths.document, "mercalys-batches");
    d.create({ idempotent: true, intermediates: true });
    const copy = new File(d, `${id}.xlsx`),
      checksum = await this.checksum(bytes);
    if (copy.exists) {
      if (
        copy.size !== bytes.length ||
        (await this.checksum(await copy.bytes())) !== checksum
      )
        throw Error("MERCALYS_ZIP_MEMBER_CHANGED");
    } else {
      copy.create();
      copy.write(bytes);
      if (!copy.exists || copy.size !== bytes.length)
        throw Error("MERCALYS_ZIP_COPY_FAILED");
    }
    return { localUri: copy.uri, sizeBytes: bytes.length, checksum };
  },
  async memberId(parentId, path) {
    const { digestStringAsync, CryptoDigestAlgorithm } =
      await import("expo-crypto");
    const h = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      `mercalys-archive/${parentId}/${path}`,
    );
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  },
  pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
};
