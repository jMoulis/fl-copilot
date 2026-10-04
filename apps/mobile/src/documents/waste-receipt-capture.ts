export const WASTE_RECEIPT_CAPTURE_DIRECTORY = "waste-receipts";

export interface WasteReceiptCaptureStorage {
  persist(input: { temporaryUri: string; filename: string }): Promise<string>;
}

export async function persistWasteReceiptCapture(
  input: { temporaryUri: string; captureId: string },
  storage: WasteReceiptCaptureStorage = nativeWasteReceiptCaptureStorage,
) {
  const filename = `${input.captureId}.jpg`;
  const localUri = await storage.persist({
    temporaryUri: input.temporaryUri,
    filename,
  });
  return { localUri, filename };
}

const nativeWasteReceiptCaptureStorage: WasteReceiptCaptureStorage = {
  async persist({ temporaryUri, filename }) {
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
    if (source.exists) source.delete();
    return destination.uri;
  },
};
