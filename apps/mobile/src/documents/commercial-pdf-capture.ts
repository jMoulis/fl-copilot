import { sourceUploadChecksumSchema } from "@fl-copilot/sync-contracts";
import { SourceDocumentRepository } from "./source-document-repository";

export const COMMERCIAL_PDF_DIRECTORY = "commercial-pdfs";
export const MAX_COMMERCIAL_PDF_BYTES = 100 * 1024 * 1024;

export interface CommercialPdfStorage {
  persist(input: { uri: string; filename: string }): Promise<{
    localUri: string;
    sizeBytes: number;
    checksum: string;
  }>;
  remove(localUri: string): Promise<void>;
}

export function assertPdfHeader(bytes: Uint8Array) {
  // Bound header inspection; full structural parsing belongs to M5-T03.
  const prefix = Array.from(bytes.subarray(0, 1024), (byte) =>
    String.fromCharCode(byte),
  ).join("");
  if (!/%PDF-\d\.\d/.test(prefix)) throw new Error("COMMERCIAL_PDF_INVALID");
}

export async function captureCommercialPdf(
  input: {
    uri: string;
    originalFilename: string;
    mimeType?: string | null;
    storeId: string;
    documentId: string;
    fileId: string;
    capturedAt: string;
  },
  repository: SourceDocumentRepository,
  storage: CommercialPdfStorage = nativeCommercialPdfStorage,
) {
  if (
    input.mimeType &&
    !["application/pdf", "application/octet-stream"].includes(
      input.mimeType.toLowerCase(),
    )
  )
    throw new Error("COMMERCIAL_PDF_INVALID");
  const persisted = await storage.persist({
    uri: input.uri,
    filename: `${input.fileId}.pdf`,
  });
  try {
    if (
      persisted.sizeBytes <= 0 ||
      persisted.sizeBytes > MAX_COMMERCIAL_PDF_BYTES
    )
      throw new Error("COMMERCIAL_PDF_SIZE_INVALID");
    sourceUploadChecksumSchema.parse(persisted.checksum);
    const result = await repository.createCommercialPdf({
      document: {
        id: input.documentId,
        storeId: input.storeId,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        originalFilename: input.originalFilename,
        localFileUri: persisted.localUri,
        checksum: persisted.checksum,
        sourceGeneratedAt: null,
        businessPeriodStart: null,
        businessPeriodEnd: null,
        localProcessingStatus: "PENDING",
        remoteUploadStatus: "PENDING",
        remoteProcessingStatus: null,
        parserVersion: null,
        extractionModelVersion: null,
        version: 1,
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
        deletedAt: null,
        syncState: "PENDING",
        remoteVersion: null,
        dirty: true,
      },
      file: {
        id: input.fileId,
        storeId: input.storeId,
        sourceDocumentId: input.documentId,
        localUri: persisted.localUri,
        mimeType: "application/pdf",
        sizeBytes: persisted.sizeBytes,
        checksum: persisted.checksum,
        retentionStatus: "RETAINED",
        uploadStatus: "PENDING",
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
      },
    });
    if (result.duplicate)
      await storage.remove(persisted.localUri).catch(() => undefined);
    return result;
  } catch (error) {
    // Only this attempt's app-owned copy can be removed, never the selected original.
    await storage.remove(persisted.localUri).catch(() => undefined);
    throw error;
  }
}

const nativeCommercialPdfStorage: CommercialPdfStorage = {
  async persist({ uri, filename }) {
    const { Directory, File, Paths } = await import("expo-file-system");
    const { CryptoDigestAlgorithm, digest } = await import("expo-crypto");
    const source = new File(uri);
    if (!source.exists) throw new Error("COMMERCIAL_PDF_SOURCE_MISSING");
    if (source.size <= 0 || source.size > MAX_COMMERCIAL_PDF_BYTES)
      throw new Error("COMMERCIAL_PDF_SIZE_INVALID");
    const directory = new Directory(Paths.document, COMMERCIAL_PDF_DIRECTORY);
    directory.create({ idempotent: true, intermediates: true });
    const destination = new File(directory, filename);
    if (destination.exists)
      throw new Error("COMMERCIAL_PDF_COPY_ALREADY_EXISTS");
    try {
      await source.copy(destination);
      if (!destination.exists || destination.size !== source.size)
        throw new Error("COMMERCIAL_PDF_COPY_FAILED");
      const bytes = await destination.bytes();
      assertPdfHeader(bytes);
      const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
      return {
        localUri: destination.uri,
        sizeBytes: bytes.byteLength,
        checksum: `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      };
    } catch (error) {
      if (destination.exists) destination.delete();
      throw error;
    }
  },
  async remove(localUri) {
    const { File } = await import("expo-file-system");
    const file = new File(localUri);
    if (file.exists) file.delete();
  },
};
