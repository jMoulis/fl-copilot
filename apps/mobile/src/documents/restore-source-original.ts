import {
  sourceOriginalCopySchema,
  sourceOriginalRestorationSchema,
  type SourceOriginalCopy,
} from "@fl-copilot/domain";
import {
  SourceUploadRecoveryRepository,
  type UploadIntakeScope,
} from "./source-upload-recovery";
export interface OriginalRestorationStorage {
  /** Creates a new private copy; never overwrites the selection or a previous original. */
  copy(input: {
    uri: string;
    operationId: string;
    expectedSizeBytes: number;
    mimeType: SourceOriginalCopy["mimeType"];
  }): Promise<SourceOriginalCopy>;
  removeOwnedCopy(localUri: string): Promise<void>;
}
export async function restoreSourceOriginal(
  input: {
    storeId: string;
    sourceDocumentId: string;
    basisHash: string;
    selectedUri: string;
    operationId: string;
  },
  repo: SourceUploadRecoveryRepository,
  storage: OriginalRestorationStorage,
  authority: { canRetry(): boolean; signal?: AbortSignal },
  scope?: UploadIntakeScope,
) {
  sourceOriginalRestorationSchema.shape.operationId.parse(input.operationId);
  sourceOriginalRestorationSchema.shape.basisHash.parse(input.basisHash);
  const check = () => {
    authority.signal?.throwIfAborted();
    if (!authority.canRetry()) throw Error("SOURCE_RECOVERY_FORBIDDEN");
  };
  check();
  const current = await repo.review(
    input.storeId,
    input.sourceDocumentId,
    scope,
  );
  check();
  if (current.basisHash !== input.basisHash)
    throw Error("SOURCE_RECOVERY_CHANGED");
  if (!current.canRestore || !current.original)
    throw Error("SOURCE_RESTORATION_BLOCKED");
  const mimeType = sourceOriginalCopySchema.shape.mimeType.parse(
    current.original.mimeType,
  );
  let copy: SourceOriginalCopy | undefined;
  try {
    copy = await storage.copy({
      uri: input.selectedUri,
      operationId: input.operationId,
      expectedSizeBytes: current.original.sizeBytes,
      mimeType,
    });
    check();
    sourceOriginalCopySchema.parse(copy);
    if (
      copy.localUri === input.selectedUri ||
      copy.localUri === current.original.localUri ||
      copy.checksum !== current.original.checksum ||
      copy.sizeBytes !== current.original.sizeBytes ||
      copy.mimeType !== mimeType
    )
      throw Error("SOURCE_RESTORATION_DIFFERENT_FILE");
    return await repo.restoreOriginal(
      input.storeId,
      input.sourceDocumentId,
      { operationId: input.operationId, basisHash: input.basisHash, copy },
      authority,
      scope,
    );
  } catch (error) {
    // A database/commit uncertainty must never cause removal of a referenced original.
    if (
      copy &&
      copy.localUri !== input.selectedUri &&
      copy.localUri !== current.original.localUri
    ) {
      const referenced = await repo
        .isCopyReferenced(copy.localUri)
        .catch(() => true);
      if (!referenced)
        await storage.removeOwnedCopy(copy.localUri).catch(() => undefined);
    }
    throw error;
  }
}
export const nativeOriginalRestorationStorage: OriginalRestorationStorage = {
  async copy(input) {
    const { File, Directory, Paths } = await import("expo-file-system");
    const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
    const { z } = await import("zod");
    z.uuid().parse(input.operationId);
    const selected = new File(input.uri);
    if (!selected.exists) throw Error("SOURCE_RESTORATION_SELECTION_MISSING");
    if (
      selected.size !== input.expectedSizeBytes ||
      selected.size <= 0 ||
      selected.size > 100 * 1024 * 1024
    )
      throw Error("SOURCE_RESTORATION_DIFFERENT_FILE");
    const directory = new Directory(Paths.document, "source-restorations");
    directory.create({ idempotent: true, intermediates: true });
    const destination = new File(
      directory,
      `${input.operationId}.${input.mimeType === "application/pdf" ? "pdf" : "xlsx"}`,
    );
    if (destination.exists) throw Error("SOURCE_RESTORATION_COPY_EXISTS");
    try {
      await selected.copy(destination);
      const bytes = await destination.bytes();
      if (bytes.byteLength !== input.expectedSizeBytes)
        throw Error("SOURCE_RESTORATION_DIFFERENT_FILE");
      const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
      return {
        localUri: destination.uri,
        sizeBytes: bytes.byteLength,
        mimeType: input.mimeType,
        checksum: `sha256:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`,
      };
    } catch (error) {
      if (destination.exists) destination.delete();
      throw error;
    }
  },
  async removeOwnedCopy(localUri) {
    const { File, Directory, Paths } = await import("expo-file-system");
    const dir = new Directory(Paths.document, "source-restorations");
    const file = new File(localUri);
    if (
      file.uri !== new File(dir, file.name).uri ||
      !/^[a-f0-9-]{36}\.(pdf|xlsx)$/.test(file.name)
    )
      throw Error("SOURCE_RESTORATION_COPY_NOT_OWNED");
    if (file.exists) file.delete();
  },
};
export async function pickSourceOriginal(
  mimeType: SourceOriginalCopy["mimeType"],
) {
  const picker = await import("expo-document-picker");
  const result = await picker.getDocumentAsync({
    type: [mimeType],
    multiple: false,
    copyToCacheDirectory: true,
  });
  return result.canceled ? undefined : result.assets[0]?.uri;
}
