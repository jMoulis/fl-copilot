export const WASTE_RECEIPT_CAPTURE_DIRECTORY = "waste-receipts";

export interface WasteReceiptCaptureStorage {
  persist(input: {
    temporaryUri: string;
    filename: string;
    removeSourceAfterCopy: boolean;
  }): Promise<string>;
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
  const localUri = await storage.persist({
    temporaryUri: input.temporaryUri,
    filename,
    removeSourceAfterCopy: true,
  });
  return { localUri, filename };
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
  const localUri = await storage.persist({
    temporaryUri: input.temporaryUri,
    filename,
    removeSourceAfterCopy: false,
  });
  return { localUri, filename, extension };
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

const nativeWasteReceiptCaptureStorage: WasteReceiptCaptureStorage = {
  async persist({ temporaryUri, filename, removeSourceAfterCopy }) {
    const { Directory, File, Paths } = await import("expo-file-system");
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
    if (removeSourceAfterCopy && source.exists) source.delete();
    return destination.uri;
  },
};
