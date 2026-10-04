export const WASTE_RECEIPT_CAPTURE_DIRECTORY = "waste-receipts";

export interface PersistedWasteReceiptFile {
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export interface WasteReceiptCaptureStorage {
  persist(input: {
    temporaryUri: string;
    filename: string;
    mimeType: string;
    removeSourceAfterCopy: boolean;
  }): Promise<PersistedWasteReceiptFile>;
}

export class UnsupportedWasteReceiptImageError extends Error {
  constructor() {
    super("WASTE_RECEIPT_IMAGE_UNSUPPORTED");
    this.name = "UnsupportedWasteReceiptImageError";
  }
}

export async function persistWasteReceiptCapture(
  input: { temporaryUri: string; captureId: string },
  storage: WasteReceiptCaptureStorage = nativeWasteReceiptCaptureStorage,
) {
  const filename = `${input.captureId}.jpg`;
  const persisted = await storage.persist({
    temporaryUri: input.temporaryUri,
    filename,
    mimeType: "image/jpeg",
    removeSourceAfterCopy: true,
  });
  return { ...persisted, filename };
}

export async function persistWasteReceiptImport(
  input: {
    temporaryUri: string;
    captureId: string;
    mimeType?: string | null;
    originalFilename?: string | null;
  },
  storage: WasteReceiptCaptureStorage = nativeWasteReceiptCaptureStorage,
) {
  const extension = resolveWasteReceiptImageExtension(input);
  const filename = `${input.captureId}.${extension}`;
  const persisted = await storage.persist({
    temporaryUri: input.temporaryUri,
    filename,
    mimeType: mimeTypeForExtension(extension),
    removeSourceAfterCopy: false,
  });
  return { ...persisted, filename, extension };
}

export function resolveWasteReceiptImageExtension(input: {
  temporaryUri: string;
  mimeType?: string | null;
  originalFilename?: string | null;
}) {
  const mimeType = input.mimeType?.toLowerCase().split(";", 1)[0];
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  if (mimeType) throw new UnsupportedWasteReceiptImageError();

  const candidate = input.originalFilename ?? input.temporaryUri;
  const cleanPath = candidate.toLowerCase().split(/[?#]/, 1)[0];
  if (cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg")) return "jpg";
  if (cleanPath.endsWith(".png")) return "png";
  if (cleanPath.endsWith(".heic")) return "heic";
  if (cleanPath.endsWith(".heif")) return "heif";
  throw new UnsupportedWasteReceiptImageError();
}

function mimeTypeForExtension(extension: string) {
  if (extension === "jpg") return "image/jpeg";
  return `image/${extension}`;
}

const nativeWasteReceiptCaptureStorage: WasteReceiptCaptureStorage = {
  async persist({ temporaryUri, filename, mimeType, removeSourceAfterCopy }) {
    const { Directory, File, Paths } = await import("expo-file-system");
    const { CryptoDigestAlgorithm, digest } = await import("expo-crypto");
    const directory = new Directory(
      Paths.document,
      WASTE_RECEIPT_CAPTURE_DIRECTORY,
    );
    directory.create({ idempotent: true, intermediates: true });

    const source = new File(temporaryUri);
    if (!source.exists) throw new Error("WASTE_CAPTURE_TEMPORARY_FILE_MISSING");

    const destination = new File(directory, filename);
    await source.copy(destination);
    if (!destination.exists) throw new Error("WASTE_CAPTURE_COPY_FAILED");
    const bytes = await destination.bytes();
    const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
    const checksum = `sha256:${Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
    if (removeSourceAfterCopy && source.exists) source.delete();
    return {
      localUri: destination.uri,
      mimeType,
      sizeBytes: destination.size,
      checksum,
    };
  },
};
